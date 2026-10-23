"""SQLite access layer.

One connection per thread, WAL journaling, foreign keys on. The backend is the
only writer, so write contention is limited to its own worker threads; a five
second busy timeout absorbs the overlap between a render thread committing
progress and the API thread reading it.
"""

from __future__ import annotations

import json
import sqlite3
import threading
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path

from .clock import now_iso
from .config import get_settings

SCHEMA_PATH = Path(__file__).resolve().parent.parent / "db" / "schema.sql"
SCHEMA_VERSION = 1

_local = threading.local()
_init_lock = threading.Lock()
_initialised: set[str] = set()


def _configure(conn: sqlite3.Connection) -> None:
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode = WAL")
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute("PRAGMA synchronous = NORMAL")
    conn.execute("PRAGMA busy_timeout = 5000")


def get_connection() -> sqlite3.Connection:
    settings = get_settings()
    settings.ensure_dirs()
    path = str(settings.db_path)
    conn: sqlite3.Connection | None = getattr(_local, "conn", None)
    if conn is not None and getattr(_local, "path", None) == path:
        return conn
    if conn is not None:
        conn.close()
    conn = sqlite3.connect(path, timeout=5.0, isolation_level=None)
    _configure(conn)
    _local.conn = conn
    _local.path = path
    with _init_lock:
        if path not in _initialised:
            migrate(conn)
            _initialised.add(path)
    return conn


def reset_connections() -> None:
    """Drop cached connections — used between tests."""
    conn = getattr(_local, "conn", None)
    if conn is not None:
        conn.close()
    _local.conn = None
    _local.path = None
    _initialised.clear()


def migrate(conn: sqlite3.Connection) -> None:
    conn.executescript(SCHEMA_PATH.read_text(encoding="utf-8"))
    row = conn.execute("SELECT MAX(version) AS v FROM schema_migrations").fetchone()
    if not row or row["v"] is None:
        conn.execute(
            "INSERT INTO schema_migrations(version, name, applied_at) VALUES (?,?,?)",
            (SCHEMA_VERSION, "initial", now_iso()),
        )
    _seed(conn)


def _seed(conn: sqlite3.Connection) -> None:
    from ..services.styles import STYLE_PRESETS
    from ..services.render_presets import RENDER_PRESETS
    from .ids import new_id

    for preset in STYLE_PRESETS:
        exists = conn.execute(
            "SELECT 1 FROM subtitle_styles WHERE is_preset = 1 AND name = ?", (preset["name"],)
        ).fetchone()
        if exists:
            continue
        conn.execute(
            "INSERT INTO subtitle_styles(id, project_id, name, is_preset, payload_json, created_at, updated_at)"
            " VALUES (?,?,?,?,?,?,?)",
            (new_id("sty"), None, preset["name"], 1, json.dumps(preset), now_iso(), now_iso()),
        )
    for preset in RENDER_PRESETS:
        exists = conn.execute(
            "SELECT 1 FROM render_presets WHERE is_preset = 1 AND name = ?", (preset["name"],)
        ).fetchone()
        if exists:
            continue
        conn.execute(
            "INSERT INTO render_presets(id, name, is_preset, payload_json, created_at) VALUES (?,?,?,?,?)",
            (new_id("rp"), preset["name"], 1, json.dumps(preset), now_iso()),
        )
    for name in ("tiny", "base", "small", "medium", "large-v3"):
        conn.execute("INSERT OR IGNORE INTO asr_models(name, installed) VALUES (?, 0)", (name,))


@contextmanager
def transaction() -> Iterator[sqlite3.Connection]:
    conn = get_connection()
    conn.execute("BEGIN IMMEDIATE")
    try:
        yield conn
    except Exception:
        conn.execute("ROLLBACK")
        raise
    else:
        conn.execute("COMMIT")


def query(sql: str, params: tuple | dict = ()) -> list[sqlite3.Row]:
    return list(get_connection().execute(sql, params).fetchall())


def query_one(sql: str, params: tuple | dict = ()) -> sqlite3.Row | None:
    return get_connection().execute(sql, params).fetchone()


def execute(sql: str, params: tuple | dict = ()) -> sqlite3.Cursor:
    return get_connection().execute(sql, params)


def row_to_dict(row: sqlite3.Row | None, json_fields: tuple[str, ...] = ()) -> dict | None:
    if row is None:
        return None
    data = dict(row)
    for field in json_fields:
        if field in data and isinstance(data[field], str):
            try:
                data[field] = json.loads(data[field])
            except json.JSONDecodeError:
                data[field] = None
    return data


def get_setting(key: str, default=None):
    row = query_one("SELECT value_json FROM app_settings WHERE key = ?", (key,))
    if row is None:
        return default
    try:
        return json.loads(row["value_json"])
    except json.JSONDecodeError:
        return default


def put_setting(key: str, value) -> None:
    execute(
        "INSERT INTO app_settings(key, value_json, updated_at) VALUES (?,?,?)"
        " ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at",
        (key, json.dumps(value), now_iso()),
    )
