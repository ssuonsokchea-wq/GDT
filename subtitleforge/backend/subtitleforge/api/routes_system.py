"""Health, capabilities and settings."""

from __future__ import annotations

import os
import platform
import shutil
import sys

from fastapi import APIRouter

from .. import __version__
from ..core import db
from ..core.config import get_settings
from ..models.schemas import SettingPut
from ..services import diarize, enhance, ffmpeg, styles, transcribe

router = APIRouter(tags=["system"])


@router.get("/health")
def health() -> dict:
    return {"status": "ok", "version": __version__}


@router.get("/capabilities")
def capabilities() -> dict:
    """Everything the UI needs to decide what to offer and what to warn about.

    One call, because the alternative is five round trips during startup and a
    window that renders controls it then has to disable.
    """
    settings = get_settings()
    total, used, free = shutil.disk_usage(settings.data_dir)
    return {
        "version": __version__,
        "platform": {
            "system": platform.system(),
            "release": platform.release(),
            "machine": platform.machine(),
            "python": sys.version.split()[0],
            "cpuCount": os.cpu_count(),
        },
        "paths": {
            "dataDir": str(settings.data_dir),
            "modelsDir": str(settings.models_dir),
            "cacheDir": str(settings.cache_dir),
            "logsDir": str(settings.logs_dir),
            "database": str(settings.db_path),
        },
        "disk": {"totalGb": round(total / 1024**3, 1), "freeGb": round(free / 1024**3, 1)},
        "tools": ffmpeg.tool_status(),
        "encoders": ffmpeg.list_encoders()["encoders"],
        "asr": transcribe.backend_status(),
        "diarization": diarize.backend_status(),
        "punctuationModel": enhance.model_status(),
        "fonts": styles.list_fonts()[:400],
        "stylePresets": [preset["name"] for preset in styles.STYLE_PRESETS],
    }


@router.get("/encoders")
def encoders(verify: bool = False) -> dict:
    catalogue = ffmpeg.list_encoders(refresh=True)["encoders"]
    if verify:
        for entry in catalogue:
            if entry["available"] and entry["hardware"]:
                entry["verified"] = ffmpeg.verify_encoder(entry["name"])
    return {"encoders": catalogue}


@router.get("/models")
def models() -> dict:
    return {"models": transcribe.list_models(), "devices": transcribe.available_devices(refresh=True)}


@router.get("/fonts")
def fonts(refresh: bool = False) -> dict:
    return {"fonts": styles.list_fonts(refresh=refresh)}


@router.get("/settings")
def read_settings() -> dict:
    rows = db.query("SELECT key, value_json FROM app_settings")
    import json

    return {row["key"]: json.loads(row["value_json"]) for row in rows}


@router.put("/settings/{key}")
def write_setting(key: str, body: SettingPut) -> dict:
    db.put_setting(key, body.value)
    return {"key": key, "value": body.value}
