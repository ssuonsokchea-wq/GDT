"""Output presets for burn-in.

Quality is expressed as CRF for software encoders and as a bitrate target for
hardware ones, because NVENC and Quick Sync treat CRF as a hint at best. Each
preset therefore carries both and the renderer picks per encoder.
"""

from __future__ import annotations

from typing import Any

RENDER_PRESETS: list[dict[str, Any]] = [
    {
        "name": "Draft",
        "description": "Fast check render. Visible compression, but the timing is all you are judging.",
        "codec": "h264",
        "crf": 28,
        "bitrateKbps": 3000,
        "preset": "veryfast",
        "audio": "copy",
        "maxHeight": 720,
    },
    {
        "name": "Web 1080p",
        "description": "The default upload: 1080p H.264, AAC audio, faststart for progressive playback.",
        "codec": "h264",
        "crf": 21,
        "bitrateKbps": 8000,
        "preset": "medium",
        "audio": "aac",
        "maxHeight": 1080,
    },
    {
        "name": "Social Vertical",
        "description": "1080x1920 for Shorts, Reels and TikTok. Pads rather than crops, so nothing is lost.",
        "codec": "h264",
        "crf": 21,
        "bitrateKbps": 9000,
        "preset": "medium",
        "audio": "aac",
        "maxHeight": 1920,
        "aspect": "9:16",
    },
    {
        "name": "Master 4K",
        "description": "Near-transparent 2160p for archive or re-edit. Large files; expect a long render.",
        "codec": "h264",
        "crf": 17,
        "bitrateKbps": 40000,
        "preset": "slow",
        "audio": "copy",
        "maxHeight": 2160,
    },
    {
        "name": "HEVC 4K",
        "description": "Half the bitrate of H.264 at the same quality, on players that support it.",
        "codec": "hevc",
        "crf": 20,
        "bitrateKbps": 20000,
        "preset": "medium",
        "audio": "copy",
        "maxHeight": 2160,
    },
]

PRESETS_BY_NAME = {preset["name"]: preset for preset in RENDER_PRESETS}

DEFAULT_RENDER: dict[str, Any] = {
    "presetName": "Web 1080p",
    "encoder": "auto",
    "allowHardware": True,
    "codec": "h264",
    "crf": 21,
    "bitrateKbps": 8000,
    "preset": "medium",
    "audio": "copy",
    "maxHeight": None,
    "aspect": None,
    "suffix": "_subtitled",
}


def resolve(options: dict | None) -> dict:
    options = dict(options or {})
    preset = PRESETS_BY_NAME.get(options.get("presetName") or "", {})
    merged = {**DEFAULT_RENDER, **{k: v for k, v in preset.items() if k not in ("name", "description")}, **{
        k: v for k, v in options.items() if v is not None
    }}
    merged["crf"] = int(max(0, min(51, int(merged["crf"]))))
    merged["bitrateKbps"] = int(max(200, min(200000, int(merged["bitrateKbps"]))))
    if merged.get("audio") not in ("copy", "aac", "none"):
        merged["audio"] = "copy"
    return merged
