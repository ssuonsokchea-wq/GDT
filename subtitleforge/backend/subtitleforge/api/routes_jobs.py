"""Jobs, batches and the event stream."""

from __future__ import annotations

import asyncio
import json
from pathlib import Path

from fastapi import APIRouter, Request
from fastapi.responses import StreamingResponse

from ..core.events import broker
from ..core.jobs import manager
from ..models.schemas import BatchCreate
from ..services import pipeline

router = APIRouter(tags=["jobs"])


@router.get("/jobs")
def list_jobs(projectId: str | None = None, status: str | None = None, limit: int = 100) -> dict:
    return {"jobs": manager.list(project_id=projectId, status=status, limit=limit)}


@router.get("/jobs/{job_id}")
def get_job(job_id: str) -> dict:
    return manager.get(job_id)


@router.get("/jobs/{job_id}/events")
def job_events(job_id: str, limit: int = 200) -> dict:
    return {"events": manager.events(job_id, limit)}


@router.post("/jobs/{job_id}/cancel")
def cancel_job(job_id: str) -> dict:
    return manager.cancel(job_id)


@router.post("/batches")
def create_batch(body: BatchCreate) -> dict:
    name = body.name or f"{len(body.paths)} files"
    return pipeline.create_batch(name, body.operation, body.paths, body.options)


@router.get("/batches")
def list_batches(limit: int = 50) -> dict:
    return {"batches": pipeline.list_batches(limit)}


@router.get("/batches/{batch_id}")
def get_batch(batch_id: str) -> dict:
    return pipeline.get_batch(batch_id)


@router.post("/batches/{batch_id}/cancel")
def cancel_batch(batch_id: str) -> dict:
    return pipeline.cancel_batch(batch_id)


@router.get("/events")
async def events(request: Request, since: int | None = None) -> StreamingResponse:
    """Server-sent events: one connection carries every job's progress.

    SSE rather than WebSockets because the traffic is one-way, it survives a
    renderer reload without a handshake, and a dropped connection reconnects
    with ``Last-Event-ID`` to replay what it missed.
    """
    queue = broker.subscribe(since)

    async def stream():
        try:
            yield f": connected\ndata: {json.dumps({'type': 'hello'})}\n\n"
            while True:
                if await request.is_disconnected():
                    break
                try:
                    event = await asyncio.wait_for(queue.get(), timeout=15.0)
                except asyncio.TimeoutError:
                    # A comment every 15 s keeps proxies and the renderer's
                    # fetch from treating a quiet stream as dead.
                    yield ": keep-alive\n\n"
                    continue
                yield f"id: {event['seq']}\nevent: {event.get('type', 'message')}\ndata: {json.dumps(event)}\n\n"
        finally:
            broker.unsubscribe(queue)

    return StreamingResponse(
        stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache, no-transform", "X-Accel-Buffering": "no", "Connection": "keep-alive"},
    )
