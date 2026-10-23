"""Job queue.

Transcription and rendering are long, CPU-bound and cancellable. They run on a
small pool of worker threads, each job writing progress to SQLite and pushing
an event to the broker. The renderer never polls: it listens to one SSE stream
and reconciles against ``GET /jobs`` when it reconnects.
"""

from __future__ import annotations

import json
import logging
import queue
import threading
from dataclasses import dataclass
from typing import Any, Callable

from . import db
from .clock import now_iso
from .errors import AppError, JobCancelled, NotFound
from .events import broker
from .ids import new_id

log = logging.getLogger("subtitleforge.jobs")

JOB_JSON_FIELDS = ("payload_json", "result_json", "error_json")

Handler = Callable[["JobContext", dict[str, Any]], dict[str, Any] | None]


class JobContext:
    """What a handler is given: identity, progress reporting, cancellation."""

    def __init__(self, job_id: str, manager: "JobManager", payload: dict[str, Any]):
        self.job_id = job_id
        self.payload = payload
        self._manager = manager
        self._last_published = -1.0

    @property
    def cancelled(self) -> bool:
        return self._manager.is_cancel_requested(self.job_id)

    def check_cancelled(self) -> None:
        if self.cancelled:
            raise JobCancelled("Job cancelled by user")

    def progress(self, fraction: float, stage: str | None = None, message: str | None = None) -> None:
        self.check_cancelled()
        fraction = max(0.0, min(1.0, float(fraction)))
        # Throttle: a 2 hour render emits progress hundreds of times a second.
        if fraction - self._last_published < 0.002 and fraction < 1.0 and message is None:
            return
        self._last_published = fraction
        self._manager._update_progress(self.job_id, fraction, stage, message)

    def log(self, message: str, level: str = "info", stage: str | None = None) -> None:
        self._manager._append_event(self.job_id, message, level, stage)

    def sub(self, start: float, end: float) -> "SubProgress":
        """A progress view scaled into [start, end] of the parent job."""
        return SubProgress(self, start, end)


@dataclass(slots=True)
class SubProgress:
    parent: JobContext
    start: float
    end: float

    def progress(self, fraction: float, stage: str | None = None, message: str | None = None) -> None:
        span = self.end - self.start
        self.parent.progress(self.start + span * max(0.0, min(1.0, fraction)), stage, message)

    def check_cancelled(self) -> None:
        self.parent.check_cancelled()

    @property
    def cancelled(self) -> bool:
        return self.parent.cancelled

    def log(self, message: str, level: str = "info", stage: str | None = None) -> None:
        self.parent.log(message, level, stage)


class JobManager:
    def __init__(self, workers: int = 1) -> None:
        self._handlers: dict[str, Handler] = {}
        self._queue: queue.PriorityQueue = queue.PriorityQueue()
        self._threads: list[threading.Thread] = []
        self._cancelled: set[str] = set()
        self._lock = threading.Lock()
        self._workers = max(1, workers)
        self._stopping = threading.Event()
        self._counter = 0

    # ---- registration -------------------------------------------------
    def register(self, job_type: str, handler: Handler) -> None:
        self._handlers[job_type] = handler

    def start(self) -> None:
        if self._threads:
            return
        self._stopping.clear()
        self._requeue_orphans()
        for i in range(self._workers):
            thread = threading.Thread(target=self._worker, name=f"sf-worker-{i}", daemon=True)
            thread.start()
            self._threads.append(thread)

    def stop(self) -> None:
        self._stopping.set()
        for _ in self._threads:
            self._queue.put((0, 0, None))
        for thread in self._threads:
            thread.join(timeout=2)
        self._threads.clear()

    def _requeue_orphans(self) -> None:
        """A crash leaves rows in 'running'. Mark them failed so the UI is honest."""
        rows = db.query("SELECT id FROM jobs WHERE status = 'running'")
        for row in rows:
            db.execute(
                "UPDATE jobs SET status='failed', finished_at=?, error_json=? WHERE id=?",
                (
                    now_iso(),
                    json.dumps({"code": "interrupted", "message": "Interrupted by application restart"}),
                    row["id"],
                ),
            )
        for row in db.query("SELECT id, priority FROM jobs WHERE status = 'queued' ORDER BY created_at"):
            self._enqueue(row["id"], row["priority"])

    # ---- submission ---------------------------------------------------
    def submit(
        self,
        job_type: str,
        payload: dict[str, Any] | None = None,
        *,
        project_id: str | None = None,
        batch_id: str | None = None,
        priority: int = 100,
    ) -> dict[str, Any]:
        if job_type not in self._handlers:
            raise AppError(f"Unknown job type: {job_type}", code="unknown_job_type")
        job_id = new_id("job")
        db.execute(
            "INSERT INTO jobs(id, project_id, batch_id, type, status, priority, progress, payload_json, created_at)"
            " VALUES (?,?,?,?,'queued',?,0,?,?)",
            (job_id, project_id, batch_id, job_type, priority, json.dumps(payload or {}), now_iso()),
        )
        self._enqueue(job_id, priority)
        job = self.get(job_id)
        broker.publish({"type": "job.queued", "job": job})
        return job

    def _enqueue(self, job_id: str, priority: int) -> None:
        with self._lock:
            self._counter += 1
            seq = self._counter
        self._queue.put((priority, seq, job_id))

    def cancel(self, job_id: str) -> dict[str, Any]:
        job = self.get(job_id)
        if job["status"] in ("succeeded", "failed", "cancelled"):
            return job
        with self._lock:
            self._cancelled.add(job_id)
        db.execute("UPDATE jobs SET cancel_requested = 1 WHERE id = ?", (job_id,))
        if job["status"] == "queued":
            self._finish(job_id, "cancelled", None, None)
        return self.get(job_id)

    def is_cancel_requested(self, job_id: str) -> bool:
        with self._lock:
            if job_id in self._cancelled:
                return True
        row = db.query_one("SELECT cancel_requested FROM jobs WHERE id = ?", (job_id,))
        return bool(row and row["cancel_requested"])

    # ---- reads --------------------------------------------------------
    def get(self, job_id: str) -> dict[str, Any]:
        row = db.query_one("SELECT * FROM jobs WHERE id = ?", (job_id,))
        if row is None:
            raise NotFound(f"No job {job_id}")
        return db.row_to_dict(row, JOB_JSON_FIELDS)  # type: ignore[return-value]

    def list(self, *, project_id: str | None = None, status: str | None = None, limit: int = 100) -> list[dict]:
        sql = "SELECT * FROM jobs WHERE 1=1"
        params: list[Any] = []
        if project_id:
            sql += " AND project_id = ?"
            params.append(project_id)
        if status:
            sql += " AND status = ?"
            params.append(status)
        sql += " ORDER BY created_at DESC LIMIT ?"
        params.append(limit)
        return [db.row_to_dict(row, JOB_JSON_FIELDS) for row in db.query(sql, tuple(params))]  # type: ignore[misc]

    def events(self, job_id: str, limit: int = 200) -> list[dict]:
        rows = db.query(
            "SELECT ts, level, stage, progress, message FROM job_events WHERE job_id = ? ORDER BY id DESC LIMIT ?",
            (job_id, limit),
        )
        return [dict(row) for row in reversed(rows)]

    # ---- worker loop --------------------------------------------------
    def _worker(self) -> None:
        while not self._stopping.is_set():
            priority, seq, job_id = self._queue.get()
            if job_id is None:
                self._queue.task_done()
                return
            try:
                self._run(job_id)
            except Exception:  # pragma: no cover - defensive
                log.exception("worker crashed on job %s", job_id)
            finally:
                self._queue.task_done()

    def _run(self, job_id: str) -> None:
        row = db.query_one("SELECT * FROM jobs WHERE id = ?", (job_id,))
        if row is None or row["status"] != "queued":
            return
        if self.is_cancel_requested(job_id):
            self._finish(job_id, "cancelled", None, None)
            return
        payload = json.loads(row["payload_json"] or "{}")
        handler = self._handlers.get(row["type"])
        if handler is None:
            self._finish(job_id, "failed", None, {"code": "unknown_job_type", "message": row["type"]})
            return
        db.execute("UPDATE jobs SET status='running', started_at=?, stage=? WHERE id=?", (now_iso(), "starting", job_id))
        broker.publish({"type": "job.started", "job": self.get(job_id)})
        ctx = JobContext(job_id, self, payload)
        try:
            result = handler(ctx, payload) or {}
            self._finish(job_id, "succeeded", result, None)
        except JobCancelled:
            self._finish(job_id, "cancelled", None, None)
        except AppError as exc:
            log.warning("job %s failed: %s", job_id, exc.message)
            self._finish(job_id, "failed", None, {"code": exc.code, "message": exc.message, "hint": exc.hint})
        except Exception as exc:  # pragma: no cover - defensive
            log.exception("job %s crashed", job_id)
            self._finish(job_id, "failed", None, {"code": "internal_error", "message": str(exc)})

    # ---- state transitions --------------------------------------------
    def _update_progress(self, job_id: str, fraction: float, stage: str | None, message: str | None) -> None:
        db.execute(
            "UPDATE jobs SET progress=?, stage=COALESCE(?, stage), message=COALESCE(?, message) WHERE id=?",
            (fraction, stage, message, job_id),
        )
        broker.publish(
            {
                "type": "job.progress",
                "jobId": job_id,
                "progress": fraction,
                "stage": stage,
                "message": message,
            }
        )
        if message:
            self._append_event(job_id, message, "info", stage, fraction)

    def _append_event(
        self, job_id: str, message: str, level: str = "info", stage: str | None = None, progress: float | None = None
    ) -> None:
        db.execute(
            "INSERT INTO job_events(job_id, ts, level, stage, progress, message) VALUES (?,?,?,?,?,?)",
            (job_id, now_iso(), level, stage, progress, message),
        )

    def _finish(self, job_id: str, status: str, result: dict | None, error: dict | None) -> None:
        db.execute(
            "UPDATE jobs SET status=?, progress=?, finished_at=?, result_json=?, error_json=? WHERE id=?",
            (
                status,
                1.0 if status == "succeeded" else db.query_one("SELECT progress FROM jobs WHERE id=?", (job_id,))["progress"],
                now_iso(),
                json.dumps(result) if result is not None else None,
                json.dumps(error) if error is not None else None,
                job_id,
            ),
        )
        with self._lock:
            self._cancelled.discard(job_id)
        job = self.get(job_id)
        broker.publish({"type": f"job.{status}", "job": job})
        self._settle_batch(job)

    def _settle_batch(self, job: dict[str, Any]) -> None:
        batch_id = job.get("batch_id")
        if not batch_id:
            return
        item = db.query_one("SELECT id FROM batch_items WHERE job_id = ?", (job["id"],))
        if item:
            db.execute(
                "UPDATE batch_items SET status=?, output_path=?, error_json=? WHERE id=?",
                (
                    job["status"],
                    (job.get("result_json") or {}).get("output_path") if isinstance(job.get("result_json"), dict) else None,
                    json.dumps(job.get("error_json")) if job.get("error_json") else None,
                    item["id"],
                ),
            )
        pending = db.query_one(
            "SELECT COUNT(*) AS n FROM batch_items WHERE batch_id = ? AND status IN ('queued','running')",
            (batch_id,),
        )
        if pending and pending["n"] == 0:
            failed = db.query_one(
                "SELECT COUNT(*) AS n FROM batch_items WHERE batch_id = ? AND status = 'failed'", (batch_id,)
            )
            status = "completed_with_errors" if failed and failed["n"] else "completed"
            db.execute("UPDATE batches SET status=?, finished_at=? WHERE id=?", (status, now_iso(), batch_id))
            broker.publish({"type": "batch.finished", "batchId": batch_id, "status": status})


manager = JobManager()
