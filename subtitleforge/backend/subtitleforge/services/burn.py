"""Burning subtitles into video.

Hardcoded captions go through libass, the same renderer MPV and VLC use, via
FFmpeg's ``subtitles`` filter. That choice is what makes the preview honest:
the editor draws CSS that mirrors the ASS style, and the final frame is drawn
from the very ASS file the user styled.

Scaling order matters. The filter chain scales first and burns second, so the
ASS script resolution always equals the output resolution and a style never
changes size between a 1080p draft and a 4K master.
"""

from __future__ import annotations

import shutil
from dataclasses import dataclass
from pathlib import Path
from typing import Sequence

from ..core.config import get_settings
from ..core.errors import AppError
from . import ffmpeg, render_presets
from .styles import REFERENCE_HEIGHT, normalise_style
from .subtitles import Cue, write_ass


@dataclass(slots=True)
class BurnPlan:
    """Everything decided before a single frame is encoded.

    Surfacing this to the UI before the render starts is what lets a user
    discover that their 4K master is about to be re-encoded by the CPU, and
    change their mind while it is still cheap.
    """

    encoder: str
    hardware: bool
    codec: str
    output_path: str
    output_width: int
    output_height: int
    audio: str
    crf: int
    bitrate_kbps: int
    preset: str
    args: list[str]
    estimated_seconds: int | None

    def to_dict(self) -> dict:
        return {
            "encoder": self.encoder,
            "hardware": self.hardware,
            "codec": self.codec,
            "outputPath": self.output_path,
            "outputWidth": self.output_width,
            "outputHeight": self.output_height,
            "audio": self.audio,
            "crf": self.crf,
            "bitrateKbps": self.bitrate_kbps,
            "preset": self.preset,
            "estimatedSeconds": self.estimated_seconds,
            "ffmpegArgs": self.args,
        }


def default_output_path(source: str | Path, suffix: str = "_subtitled", out_dir: str | Path | None = None) -> Path:
    src = Path(source)
    folder = Path(out_dir) if out_dir else src.parent
    candidate = folder / f"{src.stem}{suffix}.mp4"
    counter = 2
    while candidate.exists():
        candidate = folder / f"{src.stem}{suffix}_{counter}.mp4"
        counter += 1
    return candidate


def write_style_file(
    cues: Sequence[Cue],
    style: dict | None,
    *,
    target: Path,
    width: int,
    height: int,
    title: str = "SubtitleForge AI",
    speaker_styles: dict[str, dict] | None = None,
    include_speakers: bool = False,
) -> Path:
    target.parent.mkdir(parents=True, exist_ok=True)
    body = write_ass(
        cues,
        style=style,
        play_res=(width, height),
        title=title,
        include_speakers=include_speakers,
        speaker_styles=speaker_styles,
    )
    target.write_text(body, encoding="utf-8")
    return target


def _output_size(width: int, height: int, options: dict) -> tuple[int, int]:
    max_height = options.get("maxHeight")
    out_w, out_h = width, height
    if max_height and height > max_height:
        scale = max_height / height
        out_w = int(round(width * scale / 2) * 2)
        out_h = int(round(height * scale / 2) * 2)
    aspect = options.get("aspect")
    if aspect == "9:16":
        out_h = options.get("maxHeight") or 1920
        out_w = int(round(out_h * 9 / 16 / 2) * 2)
    elif aspect == "1:1":
        side = options.get("maxHeight") or 1080
        out_w = out_h = side
    return max(2, out_w), max(2, out_h)


def _video_filters(source_w: int, source_h: int, out_w: int, out_h: int, subtitle_path: Path, fonts_dir: Path | None) -> str:
    filters = []
    if (out_w, out_h) != (source_w, source_h):
        # Fit inside the target box, then pad: never crop the user's framing.
        filters.append(f"scale={out_w}:{out_h}:force_original_aspect_ratio=decrease:flags=lanczos")
        filters.append(f"pad={out_w}:{out_h}:(ow-iw)/2:(oh-ih)/2:color=black")
    subtitle_arg = f"subtitles=filename='{ffmpeg.escape_filter_path(subtitle_path)}'"
    if fonts_dir and fonts_dir.exists():
        subtitle_arg += f":fontsdir='{ffmpeg.escape_filter_path(fonts_dir)}'"
    subtitle_arg += ":alpha=1"
    filters.append(subtitle_arg)
    return ",".join(filters)


def _encoder_args(encoder: str, options: dict) -> list[str]:
    """Quality settings, translated for each encoder family.

    CRF is meaningful to x264 and x265 only. NVENC takes ``-cq`` under
    constant-quality VBR, Quick Sync takes ``-global_quality``, and AMF takes a
    quality preset plus a bitrate ceiling. Passing CRF to all of them, as a lot
    of tools do, silently produces whatever the driver defaults to.
    """
    crf = options["crf"]
    bitrate = options["bitrateKbps"]
    preset = options["preset"]
    args: list[str] = ["-c:v", encoder]
    if encoder in ("libx264", "libx265"):
        args += ["-preset", preset, "-crf", str(crf), "-pix_fmt", "yuv420p"]
    elif encoder.endswith("_nvenc"):
        nvenc_preset = {"veryfast": "p1", "fast": "p3", "medium": "p4", "slow": "p6"}.get(preset, "p4")
        args += ["-preset", nvenc_preset, "-rc", "vbr", "-cq", str(crf), "-b:v", f"{bitrate}k",
                 "-maxrate", f"{int(bitrate * 1.5)}k", "-bufsize", f"{bitrate * 2}k", "-pix_fmt", "yuv420p"]
    elif encoder.endswith("_qsv"):
        args += ["-global_quality", str(crf), "-look_ahead", "1", "-pix_fmt", "nv12"]
    elif encoder.endswith("_amf"):
        amf_quality = {"veryfast": "speed", "fast": "speed", "medium": "balanced", "slow": "quality"}.get(preset, "balanced")
        args += ["-quality", amf_quality, "-rc", "vbr_peak", "-b:v", f"{bitrate}k",
                 "-maxrate", f"{int(bitrate * 1.5)}k", "-pix_fmt", "yuv420p"]
    elif encoder.endswith("_videotoolbox"):
        args += ["-b:v", f"{bitrate}k", "-pix_fmt", "yuv420p"]
    elif encoder == "libvpx-vp9":
        args += ["-crf", str(crf), "-b:v", "0", "-row-mt", "1"]
    else:
        args += ["-crf", str(crf)]
    return args


def plan_burn(
    media: dict,
    cues: Sequence[Cue],
    style: dict | None,
    options: dict | None = None,
    *,
    subtitle_path: Path | None = None,
    output_path: str | Path | None = None,
    speaker_styles: dict[str, dict] | None = None,
) -> BurnPlan:
    opts = render_presets.resolve(options)
    source_w = media.get("width") or 1920
    source_h = media.get("height") or 1080
    out_w, out_h = _output_size(source_w, source_h, opts)

    settings = get_settings()
    subtitle_file = Path(subtitle_path) if subtitle_path else (settings.cache_dir / media["id"] / "burn.ass")
    write_style_file(
        cues, style, target=subtitle_file, width=out_w, height=out_h,
        title=Path(media["path"]).stem, speaker_styles=speaker_styles,
    )

    target = Path(output_path) if output_path else default_output_path(
        media["path"], opts.get("suffix", "_subtitled"), opts.get("outputDir")
    )
    encoder = ffmpeg.pick_encoder(opts.get("encoder"), opts.get("codec", "h264"), bool(opts.get("allowHardware", True)))
    hardware = encoder in ffmpeg.HW_ENCODERS

    fonts_dir = settings.data_dir / "fonts"
    args: list[str] = []
    if hardware and encoder.endswith("_nvenc"):
        # Decode on the GPU but hand frames back to system memory: libass draws
        # in software, so a fully GPU chain would need a download anyway.
        args += ["-hwaccel", "cuda"]
    args += ["-i", str(media["path"])]
    args += ["-vf", _video_filters(source_w, source_h, out_w, out_h, subtitle_file, fonts_dir)]
    args += _encoder_args(encoder, opts)
    audio = opts.get("audio", "copy")
    if audio == "none":
        args += ["-an"]
    elif audio == "aac":
        args += ["-c:a", "aac", "-b:a", "192k"]
    else:
        # Copy only works when the container accepts the codec; AAC in MP4 is
        # the normal case, and FFmpeg errors loudly rather than silently if not.
        args += ["-c:a", "copy"]
    args += ["-map", "0:v:0"]
    if audio != "none":
        args += ["-map", "0:a:0?"]
    args += ["-movflags", "+faststart", "-map_metadata", "0", str(target)]

    from .media import estimate_render_seconds

    return BurnPlan(
        encoder=encoder,
        hardware=hardware,
        codec=opts.get("codec", "h264"),
        output_path=str(target),
        output_width=out_w,
        output_height=out_h,
        audio=audio,
        crf=opts["crf"],
        bitrate_kbps=opts["bitrateKbps"],
        preset=opts["preset"],
        args=args,
        estimated_seconds=estimate_render_seconds(media.get("duration_ms"), out_w, hardware),
    )


def burn(
    media: dict,
    cues: Sequence[Cue],
    style: dict | None,
    options: dict | None = None,
    *,
    output_path: str | Path | None = None,
    progress=None,
    should_cancel=None,
    speaker_styles: dict[str, dict] | None = None,
) -> dict:
    if not cues:
        raise AppError("Nothing to burn: the subtitle track is empty", code="empty_track")
    plan = plan_burn(media, cues, style, options, output_path=output_path, speaker_styles=speaker_styles)
    target = Path(plan.output_path)
    target.parent.mkdir(parents=True, exist_ok=True)
    free = shutil.disk_usage(target.parent).free
    estimated = int((media.get("duration_ms") or 0) / 1000 * plan.bitrate_kbps * 1000 / 8 * 1.15)
    if estimated and free < estimated:
        raise AppError(
            f"Not enough free space for the render (needs about {estimated // (1024 ** 2)} MB)",
            code="disk_full",
            hint="Choose another output folder, or a lower-bitrate preset.",
        )

    try:
        ffmpeg.run_with_progress(
            plan.args,
            duration_ms=media.get("duration_ms"),
            on_progress=(lambda frac, stage: progress(frac, "rendering")) if progress else None,
            should_cancel=should_cancel,
            stage="burn",
        )
    except Exception:
        # A half-written MP4 is worse than none: it looks like a finished file.
        if target.exists():
            try:
                target.unlink()
            except OSError:
                pass
        raise

    size = target.stat().st_size if target.exists() else 0
    return {
        **plan.to_dict(),
        "output_path": str(target),
        "sizeBytes": size,
        "sizeMb": round(size / (1024 * 1024), 2),
    }


def retry_without_hardware(options: dict | None) -> dict:
    """Options for the automatic second attempt after a hardware encoder fails.

    Driver-level encoder failures are common and unpredictable — a laptop on
    battery, a session with no display attached, an older driver refusing a
    4K B-frame setting. Falling back to software once, and telling the user it
    happened, turns a failed render into a slower one.
    """
    merged = dict(options or {})
    merged["allowHardware"] = False
    merged["encoder"] = "auto"
    return merged
