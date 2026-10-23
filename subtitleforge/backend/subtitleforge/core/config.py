"""Runtime configuration.

The backend is a local sidecar started by the Electron main process. Everything
it needs arrives through command-line flags or the environment, so the same
module serves development (``python -m subtitleforge``) and the packaged
PyInstaller binary.
"""

from __future__ import annotations

import os
import secrets
import shutil
import sys
from dataclasses import dataclass, field
from pathlib import Path

APP_NAME = "SubtitleForge"


def default_data_dir() -> Path:
    """Per-user application directory, following each platform's convention."""
    if sys.platform.startswith("win"):
        base = os.environ.get("APPDATA") or Path.home() / "AppData" / "Roaming"
        return Path(base) / APP_NAME
    if sys.platform == "darwin":
        return Path.home() / "Library" / "Application Support" / APP_NAME
    base = os.environ.get("XDG_DATA_HOME") or Path.home() / ".local" / "share"
    return Path(base) / APP_NAME


def _resolve_tool(explicit: str | None, name: str, bundled_dir: Path | None) -> str:
    """Find an external binary: explicit path, bundled copy, then PATH."""
    if explicit:
        return explicit
    exe = f"{name}.exe" if sys.platform.startswith("win") else name
    if bundled_dir:
        candidate = bundled_dir / exe
        if candidate.exists():
            return str(candidate)
    found = shutil.which(name)
    return found or name


@dataclass(slots=True)
class Settings:
    host: str = "127.0.0.1"
    port: int = 0  # 0 lets the OS pick a free port; reported back on stdout
    token: str = field(default_factory=lambda: secrets.token_urlsafe(32))
    data_dir: Path = field(default_factory=default_data_dir)
    bundled_bin_dir: Path | None = None
    ffmpeg: str = "ffmpeg"
    ffprobe: str = "ffprobe"
    max_concurrent_jobs: int = 1
    log_level: str = "info"

    @property
    def db_path(self) -> Path:
        return self.data_dir / "subtitleforge.db"

    @property
    def cache_dir(self) -> Path:
        return self.data_dir / "cache"

    @property
    def models_dir(self) -> Path:
        return self.data_dir / "models"

    @property
    def logs_dir(self) -> Path:
        return self.data_dir / "logs"

    def ensure_dirs(self) -> None:
        for path in (self.data_dir, self.cache_dir, self.models_dir, self.logs_dir):
            path.mkdir(parents=True, exist_ok=True)

    @classmethod
    def from_env(cls, **overrides: object) -> "Settings":
        env = os.environ
        bundled = env.get("SF_BUNDLED_BIN")
        bundled_dir = Path(bundled) if bundled else None
        data_dir = Path(env["SF_DATA_DIR"]) if env.get("SF_DATA_DIR") else default_data_dir()
        settings = cls(
            host=env.get("SF_HOST", "127.0.0.1"),
            port=int(env.get("SF_PORT", "0")),
            token=env.get("SF_TOKEN") or secrets.token_urlsafe(32),
            data_dir=data_dir,
            bundled_bin_dir=bundled_dir,
            max_concurrent_jobs=int(env.get("SF_MAX_JOBS", "1")),
            log_level=env.get("SF_LOG_LEVEL", "info"),
        )
        settings.ffmpeg = _resolve_tool(env.get("SF_FFMPEG"), "ffmpeg", bundled_dir)
        settings.ffprobe = _resolve_tool(env.get("SF_FFPROBE"), "ffprobe", bundled_dir)
        for key, value in overrides.items():
            if value is not None:
                setattr(settings, key, value)
        return settings


_settings: Settings | None = None


def get_settings() -> Settings:
    global _settings
    if _settings is None:
        _settings = Settings.from_env()
    return _settings


def set_settings(settings: Settings) -> Settings:
    global _settings
    _settings = settings
    return settings
