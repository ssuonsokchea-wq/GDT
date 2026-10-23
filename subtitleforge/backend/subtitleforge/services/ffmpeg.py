"""FFmpeg and FFprobe wrappers.

Two things make this more than ``subprocess.run``:

* **Progress.** FFmpeg writes machine-readable key/value pairs to a pipe with
  ``-progress``. Parsing ``out_time_us`` against the known duration gives an
  honest percentage for a two-hour 4K render instead of a spinner.
* **Cancellation.** A render the user abandoned must die promptly. The reader
  loop polls a cancel callback and terminates the process group.
"""

from __future__ import annotations

import json
import re
import shutil
import subprocess
import sys
import threading
from dataclasses import dataclass
from pathlib import Path
from typing import Callable, Iterable, Sequence

from ..core.config import get_settings
from ..core.errors import AppError, ToolMissing, UnsupportedMedia

ProgressFn = Callable[[float, str | None], None]
CancelFn = Callable[[], bool]

_NO_WINDOW = subprocess.CREATE_NO_WINDOW if sys.platform.startswith("win") else 0  # type: ignore[attr-defined]


def _popen(args: Sequence[str], **kwargs) -> subprocess.Popen:
    return subprocess.Popen(
        list(args),
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        stdin=subprocess.DEVNULL,
        text=True,
        encoding="utf-8",
        errors="replace",
        creationflags=_NO_WINDOW,
        **kwargs,
    )


def tool_status() -> dict:
    settings = get_settings()
    def describe(binary: str) -> dict:
        resolved = binary if Path(binary).exists() else shutil.which(binary)
        version = None
        if resolved:
            try:
                out = subprocess.run(
                    [resolved, "-version"], capture_output=True, text=True, timeout=10, creationflags=_NO_WINDOW
                ).stdout
                version = out.splitlines()[0] if out else None
            except Exception:
                version = None
        return {"path": resolved, "available": bool(resolved), "version": version}

    return {"ffmpeg": describe(settings.ffmpeg), "ffprobe": describe(settings.ffprobe)}


def require_tools() -> None:
    status = tool_status()
    missing = [name for name, info in status.items() if not info["available"]]
    if missing:
        raise ToolMissing(
            f"{' and '.join(missing)} not found",
            hint="Install FFmpeg, or point Settings → Tools at an ffmpeg binary. "
            "The Windows installer bundles one; a portable build may not.",
        )


# --------------------------------------------------------------------------
# Probing
# --------------------------------------------------------------------------

SUPPORTED_CONTAINERS = {".mp4", ".mov", ".mkv", ".avi", ".webm", ".m4v", ".mpg", ".mpeg", ".wmv", ".flv"}


def probe(path: str | Path) -> dict:
    """Full ffprobe JSON for a media file."""
    settings = get_settings()
    require_tools()
    media_path = Path(path)
    if not media_path.exists():
        raise AppError(f"File not found: {media_path}", code="file_not_found", status=404)
    args = [
        settings.ffprobe,
        "-v", "error",
        "-print_format", "json",
        "-show_format",
        "-show_streams",
        str(media_path),
    ]
    proc = subprocess.run(args, capture_output=True, text=True, creationflags=_NO_WINDOW)
    if proc.returncode != 0:
        raise UnsupportedMedia(
            f"FFprobe could not read {media_path.name}",
            hint="The file may be corrupt, still being written, or in a container FFmpeg was not built with.",
            details={"stderr": proc.stderr.strip()[-2000:]},
        )
    try:
        return json.loads(proc.stdout)
    except json.JSONDecodeError as exc:  # pragma: no cover - ffprobe always emits valid json
        raise UnsupportedMedia(f"Unreadable ffprobe output for {media_path.name}") from exc


def _parse_fraction(value: str | None) -> float | None:
    if not value:
        return None
    if "/" in value:
        num, _, den = value.partition("/")
        try:
            numerator, denominator = float(num), float(den)
        except ValueError:
            return None
        if denominator == 0:
            return None
        return numerator / denominator
    try:
        return float(value)
    except ValueError:
        return None


@dataclass(slots=True)
class MediaInfo:
    path: str
    filename: str
    container: str | None
    size_bytes: int | None
    duration_ms: int | None
    width: int | None
    height: int | None
    fps: float | None
    video_codec: str | None
    audio_codec: str | None
    audio_channels: int | None
    audio_sample_rate: int | None
    has_audio: bool
    raw: dict

    def to_dict(self) -> dict:
        data = {
            "path": self.path,
            "filename": self.filename,
            "container": self.container,
            "sizeBytes": self.size_bytes,
            "durationMs": self.duration_ms,
            "width": self.width,
            "height": self.height,
            "fps": self.fps,
            "videoCodec": self.video_codec,
            "audioCodec": self.audio_codec,
            "audioChannels": self.audio_channels,
            "audioSampleRate": self.audio_sample_rate,
            "hasAudio": self.has_audio,
        }
        return data


def media_info(path: str | Path) -> MediaInfo:
    media_path = Path(path)
    raw = probe(media_path)
    fmt = raw.get("format", {})
    streams = raw.get("streams", [])
    video = next((s for s in streams if s.get("codec_type") == "video"), None)
    audio = next((s for s in streams if s.get("codec_type") == "audio"), None)
    duration = fmt.get("duration") or (video or {}).get("duration") or (audio or {}).get("duration")
    fps = _parse_fraction((video or {}).get("avg_frame_rate")) or _parse_fraction((video or {}).get("r_frame_rate"))
    if fps is not None and fps <= 0:
        fps = None
    return MediaInfo(
        path=str(media_path),
        filename=media_path.name,
        container=fmt.get("format_name"),
        size_bytes=int(fmt["size"]) if fmt.get("size") else (media_path.stat().st_size if media_path.exists() else None),
        duration_ms=int(float(duration) * 1000) if duration else None,
        width=(video or {}).get("width"),
        height=(video or {}).get("height"),
        fps=round(fps, 4) if fps else None,
        video_codec=(video or {}).get("codec_name"),
        audio_codec=(audio or {}).get("codec_name"),
        audio_channels=(audio or {}).get("channels"),
        audio_sample_rate=int(audio["sample_rate"]) if (audio or {}).get("sample_rate") else None,
        has_audio=audio is not None,
        raw=raw,
    )


# --------------------------------------------------------------------------
# Running with progress
# --------------------------------------------------------------------------

_PROGRESS_KEY = re.compile(r"^([a-z_]+)=(.*)$")


def run_with_progress(
    args: Sequence[str],
    *,
    duration_ms: int | None = None,
    on_progress: ProgressFn | None = None,
    should_cancel: CancelFn | None = None,
    stage: str | None = None,
) -> str:
    """Run FFmpeg, reporting progress and honouring cancellation.

    Returns the tail of stderr, which is where FFmpeg explains itself.
    """
    settings = get_settings()
    require_tools()
    full = [settings.ffmpeg, "-hide_banner", "-nostdin", "-y", "-progress", "pipe:1", "-loglevel", "error", *args]
    proc = _popen(full)
    stderr_tail: list[str] = []

    def drain_stderr() -> None:
        assert proc.stderr is not None
        for line in proc.stderr:
            stderr_tail.append(line.rstrip())
            if len(stderr_tail) > 200:
                del stderr_tail[0]

    err_thread = threading.Thread(target=drain_stderr, daemon=True)
    err_thread.start()

    cancelled = False
    try:
        assert proc.stdout is not None
        for line in proc.stdout:
            if should_cancel and should_cancel():
                cancelled = True
                break
            match = _PROGRESS_KEY.match(line.strip())
            if not match or on_progress is None:
                continue
            key, value = match.group(1), match.group(2)
            if key == "out_time_us" and duration_ms:
                try:
                    done_ms = int(value) / 1000.0
                except ValueError:
                    continue
                on_progress(min(1.0, done_ms / duration_ms), stage)
            elif key == "progress" and value == "end":
                on_progress(1.0, stage)
    finally:
        if cancelled:
            _terminate(proc)
        returncode = proc.wait()
        err_thread.join(timeout=2)

    if cancelled:
        from ..core.errors import JobCancelled

        raise JobCancelled("FFmpeg stopped at user request")
    if returncode != 0:
        raise AppError(
            "FFmpeg failed",
            code="ffmpeg_failed",
            status=500,
            hint="Open the job log for FFmpeg's own message. A wrong output path or an unavailable "
            "hardware encoder is the usual cause.",
            details={"stderr": "\n".join(stderr_tail[-40:]), "args": list(args)},
        )
    return "\n".join(stderr_tail[-40:])


def _terminate(proc: subprocess.Popen) -> None:
    try:
        proc.terminate()
        proc.wait(timeout=5)
    except Exception:
        try:
            proc.kill()
        except Exception:
            pass


# --------------------------------------------------------------------------
# Encoder discovery
# --------------------------------------------------------------------------

HW_ENCODERS = {
    "h264_nvenc": {"vendor": "nvidia", "codec": "h264", "label": "NVIDIA NVENC (H.264)"},
    "hevc_nvenc": {"vendor": "nvidia", "codec": "hevc", "label": "NVIDIA NVENC (HEVC)"},
    "h264_qsv": {"vendor": "intel", "codec": "h264", "label": "Intel Quick Sync (H.264)"},
    "hevc_qsv": {"vendor": "intel", "codec": "hevc", "label": "Intel Quick Sync (HEVC)"},
    "h264_amf": {"vendor": "amd", "codec": "h264", "label": "AMD AMF (H.264)"},
    "hevc_amf": {"vendor": "amd", "codec": "hevc", "label": "AMD AMF (HEVC)"},
    "h264_videotoolbox": {"vendor": "apple", "codec": "h264", "label": "Apple VideoToolbox (H.264)"},
    "hevc_videotoolbox": {"vendor": "apple", "codec": "hevc", "label": "Apple VideoToolbox (HEVC)"},
}

SOFTWARE_ENCODERS = {
    "libx264": {"vendor": "software", "codec": "h264", "label": "x264 (software)"},
    "libx265": {"vendor": "software", "codec": "hevc", "label": "x265 (software)"},
    "libvpx-vp9": {"vendor": "software", "codec": "vp9", "label": "VP9 (software)"},
}

_encoder_cache: dict | None = None


def list_encoders(refresh: bool = False) -> dict:
    """Which encoders this FFmpeg build exposes.

    Presence in ``-encoders`` means the build supports it, not that the machine
    has the hardware. Call :func:`verify_encoder` before committing a long
    render to one.
    """
    global _encoder_cache
    if _encoder_cache is not None and not refresh:
        return _encoder_cache
    settings = get_settings()
    available: set[str] = set()
    try:
        out = subprocess.run(
            [settings.ffmpeg, "-hide_banner", "-encoders"],
            capture_output=True, text=True, timeout=20, creationflags=_NO_WINDOW,
        ).stdout
        for line in out.splitlines():
            parts = line.split()
            if len(parts) >= 2 and parts[0].startswith(("V", "A", "S")):
                available.add(parts[1])
    except Exception:
        pass
    catalogue = []
    for name, meta in {**SOFTWARE_ENCODERS, **HW_ENCODERS}.items():
        catalogue.append({"name": name, "available": name in available, "hardware": name in HW_ENCODERS, **meta})
    _encoder_cache = {"encoders": catalogue}
    return _encoder_cache


def verify_encoder(name: str) -> bool:
    """Encode two black frames to /dev/null — the only honest hardware test."""
    settings = get_settings()
    args = [
        settings.ffmpeg, "-hide_banner", "-loglevel", "error", "-nostdin", "-y",
        "-f", "lavfi", "-i", "color=c=black:s=320x240:r=5:d=0.4",
        "-c:v", name, "-frames:v", "2", "-f", "null", "-",
    ]
    try:
        proc = subprocess.run(args, capture_output=True, text=True, timeout=60, creationflags=_NO_WINDOW)
        return proc.returncode == 0
    except Exception:
        return False


def pick_encoder(preferred: str | None, codec: str = "h264", allow_hardware: bool = True) -> str:
    """Choose an encoder: the user's pick, then hardware, then software."""
    catalogue = {entry["name"]: entry for entry in list_encoders()["encoders"]}
    if preferred and preferred != "auto":
        entry = catalogue.get(preferred)
        if entry and entry["available"] and (not entry["hardware"] or verify_encoder(preferred)):
            return preferred
    if allow_hardware:
        for name, meta in HW_ENCODERS.items():
            if meta["codec"] != codec:
                continue
            entry = catalogue.get(name)
            if entry and entry["available"] and verify_encoder(name):
                return name
    fallback = {"h264": "libx264", "hevc": "libx265", "vp9": "libvpx-vp9"}.get(codec, "libx264")
    return fallback


def escape_filter_path(path: str | Path) -> str:
    """Quote a path for use inside an FFmpeg filtergraph.

    Windows paths are the hard case: ``C:\\Users\\a.ass`` must become
    ``C\\:/Users/a.ass`` or the colon reads as a filter separator.
    """
    text = str(path).replace("\\", "/")
    text = text.replace(":", r"\:")
    text = text.replace("'", r"\'")
    text = text.replace("[", r"\[").replace("]", r"\]").replace(",", r"\,")
    return text
