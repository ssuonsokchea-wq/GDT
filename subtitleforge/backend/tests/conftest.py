"""Test fixtures.

Every test gets its own data directory and database, so the suite can run in
parallel and never touches a developer's real projects.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from subtitleforge.core import db  # noqa: E402
from subtitleforge.core.config import Settings, set_settings  # noqa: E402


@pytest.fixture
def settings(tmp_path: Path) -> Settings:
    config = Settings(host="127.0.0.1", port=0, token="test-token", data_dir=tmp_path / "data")
    config.ffmpeg = os.environ.get("SF_FFMPEG", "ffmpeg")
    config.ffprobe = os.environ.get("SF_FFPROBE", "ffprobe")
    config.ensure_dirs()
    set_settings(config)
    db.reset_connections()
    db.get_connection()
    yield config
    db.reset_connections()


@pytest.fixture
def client(settings: Settings):
    from fastapi.testclient import TestClient

    from subtitleforge.api.app import create_app

    with TestClient(create_app()) as test_client:
        test_client.headers.update({"X-SF-Token": settings.token})
        yield test_client
