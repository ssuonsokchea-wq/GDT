"""Media operations: audio extraction, poster frames, waveform peaks."""

from __future__ import annotations

import array
import json
import math
import subprocess
from pathlib import Path
from typing import Any

from ..core import db
from ..core.clock import now_iso
from ..core.config import get_settings
from ..core.errors import AppError, NotFound, UnsupportedMedia
from ..core.ids import new_id
from . import ffmpeg

MEDIA_JSON_FIELDS = ("probe_json",)

# Faster-Whisper resamples internally, but doing it once here keeps the model
# fed from a small file and lets the waveform and the transcript share a decode.
ASR_SAMPLE_RATE = 16000

AUDIO_FORMATS: dict[str, dict[str, Any]] = {
    "wav": {"ext": ".wav", "args": ["-c:a", "pcm_s16le"], "label": "WAV (uncompressed)"},
    "mp3": {"ext": ".mp3", "args": ["-c:a", "libmp3lame", "-q:a", "2"], "label": "MP3 (VBR ~190 kbps)"},
    "aac": {"ext": ".aac", "args": ["-c:a", "aac", "-b:a", "192k"], "label": "AAC (ADTS)"},
    "m4a": {"ext": ".m4a", "args": ["-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart"], "label": "M4A (AAC in MP4)"},
    "flac": {"ext": ".flac", "args": ["-c:a", "flac"], "label": "FLAC (lossless)"},
}


def register_media(path: str | Path, project_id: str | None = None) -> dict:
    """Probe a file and record it, reusing the row if the project already has it."""
    media_path = Path(path).expanduser()
    if media_path.suffix.lower() not in ffmpeg.SUPPORTED_CONTAINERS:
        # Probe anyway: FFmpeg reads more than the extension suggests. Reject
        # only when it genuinely has no streams we can use.
        info = ffmpeg.media_info(media_path)
        if not info.has_audio and info.width is None:
            raise UnsupportedMedia(
                f"{media_path.name} has neither video nor audio",
                hint="SubtitleForge reads MP4, MOV, MKV, AVI and WEBM.",
            )
    else:
        info = ffmpeg.media_info(media_path)

    if not info.has_audio:
        raise UnsupportedMedia(
            f"{media_path.name} has no audio track",
            code="no_audio",
            hint="Transcription needs audio. Import a file with sound, or add an audio track first.",
        )

    existing = None
    if project_id:
        existing = db.query_one(
            "SELECT * FROM media_files WHERE project_id = ? AND path = ?", (project_id, str(media_path))
        )
    if existing:
        media_id = existing["id"]
        db.execute(
            "UPDATE media_files SET duration_ms=?, width=?, height=?, fps=?, probe_json=? WHERE id=?",
            (info.duration_ms, info.width, info.height, info.fps, json.dumps(info.raw), media_id),
        )
    else:
        media_id = new_id("med")
        db.execute(
            "INSERT INTO media_files(id, project_id, path, filename, container, size_bytes, duration_ms, width, height,"
            " fps, video_codec, audio_codec, audio_channels, audio_sample_rate, has_audio, probe_json, created_at)"
            " VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
            (
                media_id, project_id, str(media_path), info.filename, info.container, info.size_bytes,
                info.duration_ms, info.width, info.height, info.fps, info.video_codec, info.audio_codec,
                info.audio_channels, info.audio_sample_rate, 1 if info.has_audio else 0,
                json.dumps(info.raw), now_iso(),
            ),
        )
    if project_id:
        db.execute("UPDATE projects SET media_id=?, updated_at=? WHERE id=?", (media_id, now_iso(), project_id))
    return get_media(media_id)


def get_media(media_id: str) -> dict:
    row = db.query_one("SELECT * FROM media_files WHERE id = ?", (media_id,))
    if row is None:
        raise NotFound(f"No media {media_id}")
    return db.row_to_dict(row, MEDIA_JSON_FIELDS)  # type: ignore[return-value]


def work_dir(media_id: str) -> Path:
    path = get_settings().cache_dir / media_id
    path.mkdir(parents=True, exist_ok=True)
    return path


def extract_audio(
    media_id: str,
    fmt: str = "wav",
    *,
    purpose: str = "asr",
    progress=None,
    should_cancel=None,
    output_path: str | Path | None = None,
) -> dict:
    """Extract an audio track. ``purpose='asr'`` forces 16 kHz mono."""
    if fmt not in AUDIO_FORMATS:
        raise AppError(f"Unsupported audio format: {fmt}", code="bad_audio_format")
    media = get_media(media_id)
    spec = AUDIO_FORMATS[fmt]
    if output_path:
        target = Path(output_path)
        target.parent.mkdir(parents=True, exist_ok=True)
    else:
        target = work_dir(media_id) / f"audio-{purpose}{spec['ext']}"

    cached = db.query_one(
        "SELECT * FROM audio_tracks WHERE media_id = ? AND purpose = ? AND format = ?", (media_id, purpose, fmt)
    )
    if cached and Path(cached["path"]).exists() and Path(cached["path"]) == target:
        return dict(cached)

    args = ["-i", media["path"], "-vn", "-sn", "-dn", "-map", "0:a:0"]
    if purpose == "asr":
        args += ["-ac", "1", "-ar", str(ASR_SAMPLE_RATE)]
    args += list(spec["args"]) + [str(target)]
    ffmpeg.run_with_progress(
        args,
        duration_ms=media.get("duration_ms"),
        on_progress=(lambda frac, stage: progress(frac, "extracting audio")) if progress else None,
        should_cancel=should_cancel,
        stage="extract_audio",
    )

    info = ffmpeg.media_info(target)
    track_id = cached["id"] if cached else new_id("aud")
    if cached:
        db.execute(
            "UPDATE audio_tracks SET path=?, codec=?, sample_rate=?, channels=?, duration_ms=?, size_bytes=? WHERE id=?",
            (str(target), info.audio_codec, info.audio_sample_rate, info.audio_channels, info.duration_ms,
             info.size_bytes, track_id),
        )
    else:
        db.execute(
            "INSERT INTO audio_tracks(id, media_id, path, format, codec, sample_rate, channels, duration_ms, size_bytes,"
            " purpose, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
            (track_id, media_id, str(target), fmt, info.audio_codec, info.audio_sample_rate, info.audio_channels,
             info.duration_ms, info.size_bytes, purpose, now_iso()),
        )
    return dict(db.query_one("SELECT * FROM audio_tracks WHERE id = ?", (track_id,)))


def poster_frame(media_id: str, at_ms: int = 0, width: int = 640) -> str:
    """A single JPEG frame, used for project cards and batch rows."""
    media = get_media(media_id)
    target = work_dir(media_id) / f"poster-{at_ms}-{width}.jpg"
    if target.exists():
        return str(target)
    seconds = max(0, at_ms) / 1000.0
    ffmpeg.run_with_progress(
        ["-ss", f"{seconds:.3f}", "-i", media["path"], "-frames:v", "1", "-vf", f"scale={width}:-2", str(target)],
        stage="poster",
    )
    db.execute("UPDATE media_files SET poster_path=? WHERE id=?", (str(target), media_id))
    return str(target)


def waveform_peaks(media_id: str, buckets: int = 2000, progress=None, should_cancel=None) -> dict:
    """Min/max peak pairs for the timeline.

    FFmpeg decodes to 8 kHz mono signed 16-bit PCM on stdout; we fold that into
    a fixed number of buckets. A two-hour film yields ~57 M samples, which this
    reduces to a 16 KB JSON file the renderer can draw at 60 fps.
    """
    media = get_media(media_id)
    target = work_dir(media_id) / f"peaks-{buckets}.json"
    if target.exists():
        return json.loads(target.read_text(encoding="utf-8"))

    settings = get_settings()
    ffmpeg.require_tools()
    rate = 8000
    args = [
        settings.ffmpeg, "-hide_banner", "-loglevel", "error", "-nostdin",
        "-i", media["path"], "-vn", "-ac", "1", "-ar", str(rate), "-f", "s16le", "-",
    ]
    duration_ms = media.get("duration_ms") or 0
    total_samples = max(1, int(rate * duration_ms / 1000))
    per_bucket = max(1, total_samples // max(1, buckets))

    peaks: list[list[float]] = []
    proc = subprocess.Popen(args, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
    assert proc.stdout is not None
    bucket_min, bucket_max, count, processed = 0, 0, 0, 0
    try:
        while True:
            if should_cancel and should_cancel():
                proc.terminate()
                from ..core.errors import JobCancelled

                raise JobCancelled("Waveform analysis cancelled")
            chunk = proc.stdout.read(per_bucket * 2 if per_bucket < 65536 else 131072)
            if not chunk:
                break
            if len(chunk) % 2:
                chunk += proc.stdout.read(1) or b"\x00"
            samples = array.array("h")
            samples.frombytes(chunk)
            for sample in samples:
                bucket_min = min(bucket_min, sample)
                bucket_max = max(bucket_max, sample)
                count += 1
                if count >= per_bucket:
                    peaks.append([round(bucket_min / 32768, 4), round(bucket_max / 32768, 4)])
                    bucket_min, bucket_max, count = 0, 0, 0
            processed += len(samples)
            if progress and total_samples:
                progress(min(0.99, processed / total_samples), "analysing audio")
    finally:
        proc.stdout.close()
        proc.wait()
    if count:
        peaks.append([round(bucket_min / 32768, 4), round(bucket_max / 32768, 4)])

    payload = {
        "mediaId": media_id,
        "durationMs": duration_ms,
        "buckets": len(peaks),
        "msPerBucket": (duration_ms / len(peaks)) if peaks else 0,
        "peaks": peaks,
    }
    target.write_text(json.dumps(payload), encoding="utf-8")
    db.execute("UPDATE media_files SET waveform_path=? WHERE id=?", (str(target), media_id))
    if progress:
        progress(1.0, "waveform ready")
    return payload


def clear_cache(media_id: str | None = None) -> dict:
    """Delete derived files. Source media is never touched."""
    settings = get_settings()
    root = settings.cache_dir / media_id if media_id else settings.cache_dir
    removed, freed = 0, 0
    if root.exists():
        for path in sorted(root.rglob("*"), reverse=True):
            try:
                if path.is_file():
                    freed += path.stat().st_size
                    path.unlink()
                    removed += 1
                else:
                    path.rmdir()
            except OSError:
                continue
    if media_id:
        db.execute("DELETE FROM audio_tracks WHERE media_id = ?", (media_id,))
    return {"removed": removed, "freedBytes": freed, "freedMb": round(freed / (1024 * 1024), 2)}


def format_duration(ms: int | None) -> str:
    if not ms:
        return "00:00:00"
    total = int(ms / 1000)
    return f"{total // 3600:02d}:{(total % 3600) // 60:02d}:{total % 60:02d}"


def estimate_render_seconds(duration_ms: int | None, width: int | None, hardware: bool) -> int | None:
    """Rough ETA shown before a burn-in starts.

    Calibrated against x264 veryfast on a 2023 laptop: software encoding runs
    near 1.5x realtime at 1080p, hardware near 8x, and cost scales with pixels.
    """
    if not duration_ms:
        return None
    pixels = (width or 1920) ** 2 * 9 / 16
    scale = pixels / (1920 * 1080)
    speed = (8.0 if hardware else 1.5) / max(0.25, math.sqrt(scale))
    return int((duration_ms / 1000) / speed)
