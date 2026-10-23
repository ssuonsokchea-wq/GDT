"""Media import, probing, audio extraction and derived assets."""

from __future__ import annotations

import json
from pathlib import Path

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse, JSONResponse

from ..core.jobs import manager
from ..models.schemas import AudioExtractRequest, MediaImport
from ..services import ffmpeg, media as media_service

router = APIRouter(prefix="/media", tags=["media"])


@router.get("/supported")
def supported() -> dict:
    return {
        "video": sorted(ext.lstrip(".") for ext in ffmpeg.SUPPORTED_CONTAINERS),
        "audio": [{"id": key, "label": spec["label"]} for key, spec in media_service.AUDIO_FORMATS.items()],
        "subtitles": ["srt", "vtt", "ass"],
    }


@router.post("/probe")
def probe(body: MediaImport) -> dict:
    """Read a file's properties without importing it.

    The import dialog calls this per file so it can show duration, resolution
    and frame rate — and refuse a file with no audio — before anything is
    written to the database.
    """
    info = ffmpeg.media_info(body.path)
    return info.to_dict()


@router.post("/import")
def import_media(body: MediaImport) -> dict:
    return media_service.register_media(body.path, body.projectId)


@router.get("/{media_id}")
def get_media(media_id: str) -> dict:
    return media_service.get_media(media_id)


@router.post("/{media_id}/audio")
def extract_audio(media_id: str, body: AudioExtractRequest) -> dict:
    job = manager.submit(
        "extract_audio",
        {"mediaId": media_id, "format": body.format, "purpose": body.purpose, "outputPath": body.outputPath},
    )
    return job


@router.post("/{media_id}/waveform")
def build_waveform(media_id: str, buckets: int = 2000) -> dict:
    return manager.submit("waveform", {"mediaId": media_id, "buckets": buckets})


@router.get("/{media_id}/waveform")
def read_waveform(media_id: str, buckets: int = 2000) -> JSONResponse:
    path = media_service.work_dir(media_id) / f"peaks-{buckets}.json"
    if not path.exists():
        raise HTTPException(status_code=404, detail={"error": {"code": "not_built", "message": "Waveform not built yet"}})
    return JSONResponse(content=json.loads(path.read_text(encoding="utf-8")))


@router.get("/{media_id}/stream")
def stream(media_id: str) -> FileResponse:
    """Serve the source video to the preview player.

    The renderer cannot load a ``file://`` URL — in development the page is
    served over HTTP, and even in production a custom protocol would have to
    reimplement range requests. Streaming through the backend gives the video
    element real seeking (Starlette answers ``Range`` with 206) on a loopback
    connection, which costs nothing measurable next to decoding 4K.
    """
    media = media_service.get_media(media_id)
    path = Path(media["path"])
    if not path.exists():
        raise HTTPException(
            status_code=404,
            detail={"error": {"code": "media_missing", "message": f"The video has moved: {path}",
                              "hint": "Use Relink in the project panel to point the project at its new location."}},
        )
    return FileResponse(path, media_type=_media_type(path), filename=path.name)


def _media_type(path: Path) -> str:
    return {
        ".mp4": "video/mp4", ".m4v": "video/mp4", ".mov": "video/quicktime",
        ".mkv": "video/x-matroska", ".webm": "video/webm", ".avi": "video/x-msvideo",
    }.get(path.suffix.lower(), "application/octet-stream")


@router.get("/{media_id}/poster")
def poster(media_id: str, atMs: int = 0, width: int = 640) -> FileResponse:
    path = media_service.poster_frame(media_id, atMs, width)
    return FileResponse(path, media_type="image/jpeg")


@router.get("/{media_id}/frame")
def frame(media_id: str, atMs: int = 0, width: int = 960) -> FileResponse:
    """A single frame, used by the style editor to preview captions over the
    real image when the video element cannot seek fast enough."""
    path = media_service.poster_frame(media_id, atMs, width)
    return FileResponse(path, media_type="image/jpeg")


@router.delete("/{media_id}/cache")
def clear_cache(media_id: str) -> dict:
    return media_service.clear_cache(media_id)
