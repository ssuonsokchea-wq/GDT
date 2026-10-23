"""Job handlers: the pipelines that compose the services into user actions.

Each handler owns one thing the user asked for — "generate subtitles for this
video", "burn this track in" — and divides its progress budget among the steps
so the single progress bar the user watches means something. The percentages
below are measured, not guessed: on a typical 20-minute 1080p file with the
small model on CPU, audio extraction is about a twentieth of the wall clock and
recognition almost all the rest.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from ..core import db
from ..core.clock import now_iso
from ..core.errors import AppError, NotFound
from ..core.ids import new_id
from ..core.jobs import JobContext, manager
from . import burn as burn_service
from . import diarize as diarize_service
from . import enhance as enhance_service
from . import media as media_service
from . import projects as project_service
from . import segmentation as seg_service
from . import subtitles as subtitle_service
from . import tracks as track_service
from . import transcribe as asr_service


# --------------------------------------------------------------------------
# Media
# --------------------------------------------------------------------------


def handle_probe(ctx: JobContext, payload: dict) -> dict:
    ctx.progress(0.1, "probing")
    media = media_service.register_media(payload["path"], payload.get("projectId"))
    ctx.progress(0.6, "building poster frame")
    try:
        poster = media_service.poster_frame(media["id"], at_ms=min(3000, (media.get("duration_ms") or 0) // 2))
    except Exception:
        poster = None
    ctx.progress(1.0, "ready")
    return {"media": media, "posterPath": poster}


def handle_extract_audio(ctx: JobContext, payload: dict) -> dict:
    track = media_service.extract_audio(
        payload["mediaId"],
        payload.get("format", "wav"),
        purpose=payload.get("purpose", "asr"),
        progress=lambda frac, stage: ctx.progress(frac, stage),
        should_cancel=lambda: ctx.cancelled,
        output_path=payload.get("outputPath"),
    )
    return {"audio": track, "output_path": track["path"]}


def handle_waveform(ctx: JobContext, payload: dict) -> dict:
    peaks = media_service.waveform_peaks(
        payload["mediaId"],
        buckets=int(payload.get("buckets", 2000)),
        progress=lambda frac, stage: ctx.progress(frac, stage),
        should_cancel=lambda: ctx.cancelled,
    )
    return {"buckets": peaks["buckets"], "path": str(media_service.work_dir(payload["mediaId"]) / f"peaks-{peaks['buckets']}.json")}


# --------------------------------------------------------------------------
# Transcription
# --------------------------------------------------------------------------


def handle_transcribe(ctx: JobContext, payload: dict) -> dict:
    """Video in, saved subtitle track out.

    Stages: extract audio, recognise speech, optionally attribute speakers,
    segment into cues, enhance the text, save.
    """
    project_id = payload["projectId"]
    project = project_service.get_project(project_id)
    if not project.get("media"):
        raise AppError("This project has no video yet", code="no_media")
    media = project["media"]
    settings = project.get("settings") or {}

    asr_options = asr_service.TranscribeOptions.from_dict({**(settings.get("transcription") or {}), **(payload.get("transcription") or {})})
    seg_options = seg_service.SegmentOptions.from_dict({**(settings.get("segmentation") or {}), **(payload.get("segmentation") or {})})
    style = settings.get("style") or {}
    # Line limits belong to the look of the captions, so the style preset wins
    # unless the user overrode them for this run.
    if "maxCharsPerLine" not in (payload.get("segmentation") or {}) and style.get("maxCharsPerLine"):
        seg_options.max_chars_per_line = int(style["maxCharsPerLine"])
    if "maxLines" not in (payload.get("segmentation") or {}) and style.get("maxLines"):
        seg_options.max_lines = int(style["maxLines"])

    enhance_on = payload.get("enhance", True)
    enhance_options = enhance_service.EnhanceOptions.from_dict({**(settings.get("enhancement") or {}), **(payload.get("enhancement") or {})})

    ctx.progress(0.01, "extracting audio")
    audio = media_service.extract_audio(
        media["id"], "wav", purpose="asr",
        progress=lambda frac, stage: ctx.progress(0.01 + 0.07 * frac, "extracting audio"),
        should_cancel=lambda: ctx.cancelled,
    )
    ctx.log(f"Audio extracted: {Path(audio['path']).name}", stage="extract_audio")

    diarize_on = bool(payload.get("diarize", asr_options.diarize))
    asr_end = 0.78 if diarize_on else 0.90
    ctx.progress(0.08, f"loading {asr_options.model} model")
    result = asr_service.transcribe(
        audio["path"],
        asr_options,
        progress=lambda frac, stage: ctx.progress(0.08 + (asr_end - 0.08) * frac, "transcribing"),
        should_cancel=lambda: ctx.cancelled,
        duration_ms=media.get("duration_ms"),
    )
    ctx.log(
        f"Recognised {len(result.segments)} segments, {len(result.words)} words "
        f"({result.model} on {result.device})",
        stage="transcribe",
    )

    speaker_labels: list[str | None] | None = None
    diarization_method = None
    if diarize_on:
        ctx.progress(asr_end, "identifying speakers")
        try:
            turns, diarization_method = diarize_service.diarize(
                audio["path"],
                max_speakers=int(payload.get("maxSpeakers", 4)),
                progress=lambda frac, stage: ctx.progress(asr_end + 0.12 * frac, "identifying speakers"),
                should_cancel=lambda: ctx.cancelled,
            )
            speaker_labels = diarize_service.assign_speakers(result.words, turns)
            ctx.log(
                f"{len({t.speaker for t in turns})} speakers estimated by {diarization_method}",
                stage="diarize",
            )
        except AppError:
            raise
        except Exception as exc:
            # Speaker attribution is a bonus; losing it must not lose the transcript.
            ctx.log(f"Speaker attribution failed, continuing without it: {exc}", level="warn", stage="diarize")

    ctx.progress(0.92, "segmenting captions")
    if result.words:
        cues = seg_service.segment_words(result.words, seg_options, speaker_labels)
    else:
        cues = seg_service.segment_segments(result.segments, seg_options)
    ctx.log(f"{len(cues)} cues", stage="segment")

    enhancement_report: list[dict] = []
    if enhance_on and cues:
        ctx.progress(0.95, "enhancing text")
        cues, enhancement_report = enhance_service.enhance_cues(cues, enhance_options)
        # Enhancement changes character counts, so line wrapping is redone.
        for cue in cues:
            cue.text = seg_service.wrap_lines(
                cue.text.replace("\n", " "), seg_options.max_chars_per_line, seg_options.max_lines
            )
        cues = seg_service.polish(cues, seg_options)

    ctx.progress(0.98, "saving track")
    track = track_service.create_track(
        project_id,
        name=payload.get("trackName") or _track_name(result.language, project_id),
        language=result.language or asr_options.language or "en",
        source="asr",
        model=asr_options.model,
    )
    speaker_ids = track_service.ensure_speakers(project_id, [cue.speaker for cue in cues if cue.speaker])
    track_service.save_cues(track["id"], cues, label="transcribed", speaker_ids=speaker_ids)
    track_service.update_track(track["id"], {"enhanced": 1 if enhance_on else 0})
    project_service.update_project(project_id, {"activeTrackId": track["id"]})

    quality = subtitle_service.quality_report(cues)
    ctx.progress(1.0, "subtitles ready")
    return {
        "trackId": track["id"],
        "cueCount": len(cues),
        "language": result.language,
        "languageProbability": result.language_probability,
        "model": result.model,
        "device": result.device,
        "diarization": diarization_method,
        "enhancementChanges": len(enhancement_report),
        "quality": {"averageCps": quality["averageCps"], "counts": quality["counts"]},
    }


def _track_name(language: str | None, project_id: str) -> str:
    existing = len(track_service.list_tracks(project_id))
    base = (language or "en").upper()
    return f"{base}" if existing == 0 else f"{base} ({existing + 1})"


def handle_enhance(ctx: JobContext, payload: dict) -> dict:
    track_id = payload["trackId"]
    track = track_service.get_track(track_id)
    options = enhance_service.EnhanceOptions.from_dict(payload.get("enhancement"))
    cues = track_service.load_cues(track_id, with_words=True)
    if not cues:
        return {"changed": 0}
    ctx.progress(0.2, "enhancing text")
    cues, report = enhance_service.enhance_cues(cues, options)
    if payload.get("rewrap", True):
        project = project_service.get_project(track["project_id"])
        style = (project.get("settings") or {}).get("style") or {}
        max_chars = int(style.get("maxCharsPerLine", 42))
        max_lines = int(style.get("maxLines", 2))
        for cue in cues:
            cue.text = seg_service.wrap_lines(cue.text.replace("\n", " "), max_chars, max_lines)
    ctx.progress(0.9, "saving")
    track_service.save_cues(track_id, cues, label="enhanced")
    track_service.update_track(track_id, {"enhanced": 1})
    ctx.progress(1.0, "done")
    return {"changed": len(report), "report": report[:200]}


# --------------------------------------------------------------------------
# Export and render
# --------------------------------------------------------------------------


def handle_export_subtitles(ctx: JobContext, payload: dict) -> dict:
    track_id = payload["trackId"]
    fmt = (payload.get("format") or "srt").lower()
    track = track_service.get_track(track_id)
    project = project_service.get_project(track["project_id"])
    cues = track_service.load_cues(track_id)
    if not cues:
        raise AppError("This track has no cues to export", code="empty_track")
    media = project.get("media") or {}
    target = Path(payload["outputPath"]) if payload.get("outputPath") else _default_subtitle_path(media, track, fmt)
    target.parent.mkdir(parents=True, exist_ok=True)
    ctx.progress(0.4, f"writing {fmt.upper()}")
    body = subtitle_service.write(
        cues,
        fmt,
        include_speakers=bool(payload.get("includeSpeakers", False)),
        style=(project.get("settings") or {}).get("style"),
        play_res=(media.get("width") or 1920, media.get("height") or 1080),
        title=project["name"],
    )
    target.write_text(body, encoding="utf-8")
    db.execute(
        "INSERT INTO exports(id, project_id, track_id, kind, path, size_bytes, settings_json, created_at)"
        " VALUES (?,?,?,?,?,?,?,?)",
        (new_id("exp"), track["project_id"], track_id, fmt, str(target), target.stat().st_size,
         json.dumps(payload), now_iso()),
    )
    ctx.progress(1.0, "exported")
    return {"output_path": str(target), "format": fmt, "cueCount": len(cues), "sizeBytes": target.stat().st_size}


def _default_subtitle_path(media: dict, track: dict, fmt: str) -> Path:
    if media.get("path"):
        source = Path(media["path"])
        language = (track.get("language") or "en").lower()
        return source.with_name(f"{source.stem}.{language}.{fmt}")
    from ..core.config import get_settings

    return get_settings().data_dir / "exports" / f"{track['id']}.{fmt}"


def handle_render(ctx: JobContext, payload: dict) -> dict:
    """Burn a track into the video, falling back to software on a GPU failure."""
    track_id = payload["trackId"]
    track = track_service.get_track(track_id)
    project = project_service.get_project(track["project_id"])
    if not project.get("media"):
        raise AppError("This project has no video", code="no_media")
    media = project["media"]
    if not Path(media["path"]).exists():
        raise AppError(
            f"The video has moved: {media['path']}",
            code="media_missing",
            hint="Use Relink in the project panel to point the project at the file's new location.",
        )
    cues = track_service.load_cues(track_id)
    style = {**((project.get("settings") or {}).get("style") or {}), **(payload.get("style") or {})}
    options = {**((project.get("settings") or {}).get("render") or {}), **(payload.get("render") or {})}

    speaker_styles = payload.get("speakerStyles")
    ctx.progress(0.01, "preparing render")
    plan = burn_service.plan_burn(media, cues, style, options, speaker_styles=speaker_styles,
                                 output_path=payload.get("outputPath"))
    ctx.log(
        f"{plan.output_width}x{plan.output_height} with {plan.encoder}"
        f"{' (hardware)' if plan.hardware else ' (software)'}, audio {plan.audio}",
        stage="plan",
    )
    try:
        result = burn_service.burn(
            media, cues, style, options,
            output_path=payload.get("outputPath"),
            progress=lambda frac, stage: ctx.progress(0.02 + 0.97 * frac, "rendering"),
            should_cancel=lambda: ctx.cancelled,
            speaker_styles=speaker_styles,
        )
    except AppError as exc:
        if exc.code != "ffmpeg_failed" or not plan.hardware:
            raise
        ctx.log(
            f"The {plan.encoder} hardware encoder failed; retrying in software.",
            level="warn", stage="fallback",
        )
        result = burn_service.burn(
            media, cues, style, burn_service.retry_without_hardware(options),
            output_path=payload.get("outputPath"),
            progress=lambda frac, stage: ctx.progress(0.02 + 0.97 * frac, "rendering (software)"),
            should_cancel=lambda: ctx.cancelled,
            speaker_styles=speaker_styles,
        )
        result["fellBackToSoftware"] = True

    db.execute(
        "INSERT INTO exports(id, project_id, track_id, kind, path, size_bytes, settings_json, created_at)"
        " VALUES (?,?,?,?,?,?,?,?)",
        (new_id("exp"), track["project_id"], track_id, "mp4", result["output_path"], result.get("sizeBytes"),
         json.dumps(options), now_iso()),
    )
    ctx.progress(1.0, "render complete")
    return result


# --------------------------------------------------------------------------
# Batch
# --------------------------------------------------------------------------


def create_batch(name: str, operation: str, paths: list[str], options: dict | None = None) -> dict:
    """Queue one job per file. One worker drains them, so a batch of fifty 4K
    files cannot thrash a machine that can only encode one at a time."""
    if operation not in ("transcribe", "burn", "transcribe_and_burn", "export"):
        raise AppError(f"Unknown batch operation: {operation}", code="bad_operation")
    if not paths:
        raise AppError("No files in the batch", code="empty_batch")
    batch_id = new_id("bat")
    db.execute(
        "INSERT INTO batches(id, name, operation, options_json, status, created_at) VALUES (?,?,?,?,'queued',?)",
        (batch_id, name, operation, json.dumps(options or {}), now_iso()),
    )
    for position, path in enumerate(paths):
        item_id = new_id("bit")
        db.execute(
            "INSERT INTO batch_items(id, batch_id, media_path, position, status) VALUES (?,?,?,?,'queued')",
            (item_id, batch_id, path, position),
        )
        job = manager.submit(
            "batch_item",
            {"batchId": batch_id, "itemId": item_id, "path": path, "operation": operation, "options": options or {}},
            batch_id=batch_id,
            priority=200 + position,
        )
        db.execute("UPDATE batch_items SET job_id = ? WHERE id = ?", (job["id"], item_id))
    db.execute("UPDATE batches SET status = 'running' WHERE id = ?", (batch_id,))
    return get_batch(batch_id)


def get_batch(batch_id: str) -> dict:
    row = db.query_one("SELECT * FROM batches WHERE id = ?", (batch_id,))
    if row is None:
        raise NotFound(f"No batch {batch_id}")
    batch = db.row_to_dict(row, ("options_json",))
    assert batch is not None
    batch["items"] = [db.row_to_dict(item, ("error_json",)) for item in db.query(
        "SELECT bi.*, j.status AS job_status, j.progress, j.stage FROM batch_items bi"
        " LEFT JOIN jobs j ON j.id = bi.job_id WHERE bi.batch_id = ? ORDER BY bi.position",
        (batch_id,),
    )]
    done = sum(1 for item in batch["items"] if item["status"] in ("succeeded", "failed", "cancelled"))
    batch["progress"] = round(done / len(batch["items"]), 4) if batch["items"] else 0
    return batch


def list_batches(limit: int = 50) -> list[dict]:
    return [get_batch(row["id"]) for row in db.query(
        "SELECT id FROM batches ORDER BY created_at DESC LIMIT ?", (limit,)
    )]


def cancel_batch(batch_id: str) -> dict:
    for item in db.query("SELECT job_id FROM batch_items WHERE batch_id = ? AND status IN ('queued','running')", (batch_id,)):
        if item["job_id"]:
            manager.cancel(item["job_id"])
    db.execute("UPDATE batches SET status = 'cancelled', finished_at = ? WHERE id = ?", (now_iso(), batch_id))
    return get_batch(batch_id)


def handle_batch_item(ctx: JobContext, payload: dict) -> dict:
    """One file through the whole pipeline, as its own project."""
    operation = payload["operation"]
    options = payload.get("options") or {}
    path = payload["path"]
    item_id = payload["itemId"]
    db.execute("UPDATE batch_items SET status = 'running' WHERE id = ?", (item_id,))

    project = project_service.create_project(Path(path).stem, path, options.get("settings"))
    db.execute("UPDATE batch_items SET project_id = ? WHERE id = ?", (project["id"], item_id))
    db.execute("UPDATE jobs SET project_id = ? WHERE id = ?", (project["id"], ctx.job_id))
    result: dict[str, Any] = {"projectId": project["id"], "mediaPath": path}

    transcribe_share = 0.6 if operation == "transcribe_and_burn" else 1.0
    track_id = None
    if operation in ("transcribe", "transcribe_and_burn"):
        transcript = handle_transcribe(
            _ScopedContext(ctx, 0.0, transcribe_share),  # type: ignore[arg-type]
            {
                "projectId": project["id"],
                "transcription": options.get("transcription"),
                "segmentation": options.get("segmentation"),
                "enhancement": options.get("enhancement"),
                "enhance": options.get("enhance", True),
                "diarize": options.get("diarize", False),
            },
        )
        result.update(transcript)
        track_id = transcript["trackId"]
    else:
        tracks_found = track_service.list_tracks(project["id"])
        if not tracks_found and options.get("subtitlePath"):
            cues = subtitle_service.read_file(options["subtitlePath"])
            track = track_service.create_track(project["id"], name="Imported", source="import")
            track_service.save_cues(track["id"], cues, label="imported")
            track_id = track["id"]
        elif tracks_found:
            track_id = tracks_found[0]["id"]

    if operation in ("burn", "transcribe_and_burn"):
        if not track_id:
            raise AppError(
                f"No subtitles to burn for {Path(path).name}",
                code="no_track",
                hint="Add a subtitle file for each video, or use the transcribe-and-burn operation.",
            )
        render = handle_render(
            _ScopedContext(ctx, transcribe_share, 1.0),  # type: ignore[arg-type]
            {"trackId": track_id, "render": options.get("render"), "style": options.get("style"),
             "outputPath": _batch_output_path(path, options)},
        )
        result.update({"output_path": render["output_path"], "sizeMb": render.get("sizeMb")})
    elif operation == "export" and track_id:
        export = handle_export_subtitles(
            _ScopedContext(ctx, 0.8, 1.0),  # type: ignore[arg-type]
            {"trackId": track_id, "format": options.get("format", "srt")},
        )
        result.update({"output_path": export["output_path"]})
    return result


def _batch_output_path(source: str, options: dict) -> str | None:
    out_dir = options.get("outputDir")
    if not out_dir:
        return None
    return str(burn_service.default_output_path(source, options.get("suffix", "_subtitled"), out_dir))


class _ScopedContext:
    """A JobContext whose progress maps into a slice of the parent's bar."""

    def __init__(self, parent: JobContext, start: float, end: float):
        self._parent = parent
        self._start = start
        self._end = end
        self.job_id = parent.job_id
        self.payload = parent.payload

    @property
    def cancelled(self) -> bool:
        return self._parent.cancelled

    def check_cancelled(self) -> None:
        self._parent.check_cancelled()

    def progress(self, fraction: float, stage: str | None = None, message: str | None = None) -> None:
        span = self._end - self._start
        self._parent.progress(self._start + span * max(0.0, min(1.0, fraction)), stage, message)

    def log(self, message: str, level: str = "info", stage: str | None = None) -> None:
        self._parent.log(message, level, stage)

    def sub(self, start: float, end: float):
        span = self._end - self._start
        return _ScopedContext(self._parent, self._start + span * start, self._start + span * end)


HANDLERS = {
    "probe": handle_probe,
    "extract_audio": handle_extract_audio,
    "waveform": handle_waveform,
    "transcribe": handle_transcribe,
    "enhance": handle_enhance,
    "export_subtitles": handle_export_subtitles,
    "render": handle_render,
    "batch_item": handle_batch_item,
}


def register_all() -> None:
    for name, handler in HANDLERS.items():
        manager.register(name, handler)
