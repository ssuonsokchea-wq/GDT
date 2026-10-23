"""Persistence for subtitle tracks, cues, words and speakers.

Cues are saved as a whole track in one transaction. That looks wasteful next to
row-level updates, but a track is at most a few thousand rows, the editor's
operations (split, merge, resegment, shift) touch most of them anyway, and an
all-or-nothing write means a crash mid-save can never leave a track with two
cues claiming the same index.
"""

from __future__ import annotations

import json
from typing import Any, Iterable, Sequence

from ..core import db
from ..core.clock import now_iso
from ..core.errors import NotFound
from ..core.ids import new_id
from .diarize import SPEAKER_COLORS
from .subtitles import Cue, Word, renumber

TRACK_FIELDS = ("id", "project_id", "name", "language", "source", "model", "style_id", "enhanced", "cue_count",
                "created_at", "updated_at")


# --------------------------------------------------------------------------
# Tracks
# --------------------------------------------------------------------------


def create_track(
    project_id: str,
    *,
    name: str = "English",
    language: str = "en",
    source: str = "asr",
    model: str | None = None,
    style_id: str | None = None,
) -> dict:
    track_id = new_id("trk")
    db.execute(
        "INSERT INTO subtitle_tracks(id, project_id, name, language, source, model, style_id, created_at, updated_at)"
        " VALUES (?,?,?,?,?,?,?,?,?)",
        (track_id, project_id, name, language, source, model, style_id, now_iso(), now_iso()),
    )
    db.execute(
        "UPDATE projects SET active_track_id = COALESCE(active_track_id, ?), updated_at = ? WHERE id = ?",
        (track_id, now_iso(), project_id),
    )
    return get_track(track_id)


def get_track(track_id: str) -> dict:
    row = db.query_one("SELECT * FROM subtitle_tracks WHERE id = ?", (track_id,))
    if row is None:
        raise NotFound(f"No subtitle track {track_id}")
    return dict(row)


def list_tracks(project_id: str) -> list[dict]:
    return [dict(row) for row in db.query(
        "SELECT * FROM subtitle_tracks WHERE project_id = ? ORDER BY created_at", (project_id,)
    )]


def update_track(track_id: str, patch: dict) -> dict:
    allowed = {"name", "language", "source", "model", "style_id", "enhanced"}
    fields = {key: value for key, value in patch.items() if key in allowed}
    if fields:
        assignments = ", ".join(f"{key} = ?" for key in fields)
        db.execute(
            f"UPDATE subtitle_tracks SET {assignments}, updated_at = ? WHERE id = ?",
            (*fields.values(), now_iso(), track_id),
        )
    return get_track(track_id)


def delete_track(track_id: str) -> None:
    track = get_track(track_id)
    db.execute("DELETE FROM subtitle_tracks WHERE id = ?", (track_id,))
    remaining = db.query_one(
        "SELECT id FROM subtitle_tracks WHERE project_id = ? ORDER BY created_at LIMIT 1", (track["project_id"],)
    )
    db.execute(
        "UPDATE projects SET active_track_id = ?, updated_at = ? WHERE id = ? AND active_track_id = ?",
        (remaining["id"] if remaining else None, now_iso(), track["project_id"], track_id),
    )


# --------------------------------------------------------------------------
# Cues
# --------------------------------------------------------------------------


def load_cues(track_id: str, *, with_words: bool = False) -> list[Cue]:
    rows = db.query("SELECT * FROM cues WHERE track_id = ? ORDER BY start_ms, idx", (track_id,))
    speakers = {row["id"]: row["label"] for row in db.query(
        "SELECT s.id, s.label FROM speakers s JOIN subtitle_tracks t ON t.project_id = s.project_id WHERE t.id = ?",
        (track_id,),
    )}
    cues: list[Cue] = []
    for row in rows:
        cues.append(
            Cue(
                id=row["id"],
                idx=row["idx"],
                start_ms=row["start_ms"],
                end_ms=row["end_ms"],
                text=row["text"],
                raw_text=row["raw_text"],
                speaker=speakers.get(row["speaker_id"]),
                confidence=row["confidence"],
                style_override=json.loads(row["style_override_json"]) if row["style_override_json"] else None,
                locked=bool(row["locked"]),
            )
        )
    if with_words and cues:
        by_cue: dict[str, list[Word]] = {}
        for row in db.query("SELECT * FROM words WHERE track_id = ? ORDER BY start_ms", (track_id,)):
            by_cue.setdefault(row["cue_id"] or "", []).append(
                Word(start_ms=row["start_ms"], end_ms=row["end_ms"], text=row["text"], probability=row["probability"])
            )
        for cue in cues:
            cue.words = by_cue.get(cue.id or "", [])
    return cues


def save_cues(
    track_id: str,
    cues: Sequence[Cue],
    *,
    label: str | None = None,
    store_words: bool = True,
    speaker_ids: dict[str, str] | None = None,
) -> list[Cue]:
    """Replace a track's cues atomically and journal the commit."""
    track = get_track(track_id)
    ordered = renumber(list(cues))
    lookup = speaker_ids or _speaker_map(track["project_id"])
    with db.transaction() as conn:
        conn.execute("DELETE FROM words WHERE track_id = ?", (track_id,))
        conn.execute("DELETE FROM cues WHERE track_id = ?", (track_id,))
        for cue in ordered:
            cue.id = cue.id or new_id("cue")
            conn.execute(
                "INSERT INTO cues(id, track_id, idx, start_ms, end_ms, text, raw_text, speaker_id, confidence,"
                " style_override_json, locked, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
                (
                    cue.id, track_id, cue.idx, cue.start_ms, cue.end_ms, cue.text, cue.raw_text,
                    lookup.get(cue.speaker) if cue.speaker else None, cue.confidence,
                    json.dumps(cue.style_override) if cue.style_override else None,
                    1 if cue.locked else 0, now_iso(), now_iso(),
                ),
            )
            if store_words and cue.words:
                conn.executemany(
                    "INSERT INTO words(track_id, cue_id, start_ms, end_ms, text, probability) VALUES (?,?,?,?,?,?)",
                    [(track_id, cue.id, w.start_ms, w.end_ms, w.text, w.probability) for w in cue.words],
                )
        conn.execute(
            "UPDATE subtitle_tracks SET cue_count = ?, updated_at = ? WHERE id = ?",
            (len(ordered), now_iso(), track_id),
        )
        if label:
            conn.execute(
                "INSERT INTO cue_revisions(track_id, created_at, label, patch_json) VALUES (?,?,?,?)",
                (track_id, now_iso(), label, json.dumps({"cueCount": len(ordered)})),
            )
            # Keep the journal bounded: 200 commits is far more than any undo
            # stack the user can reach, and it stops a long session growing the
            # database without limit.
            conn.execute(
                "DELETE FROM cue_revisions WHERE track_id = ? AND id NOT IN"
                " (SELECT id FROM cue_revisions WHERE track_id = ? ORDER BY id DESC LIMIT 200)",
                (track_id, track_id),
            )
    _touch_project(track["project_id"])
    return ordered


def replace_cues_from_dicts(track_id: str, payload: Iterable[dict], *, label: str | None = None) -> list[Cue]:
    return save_cues(track_id, [Cue.from_dict(item) for item in payload], label=label)


def revisions(track_id: str, limit: int = 50) -> list[dict]:
    return [dict(row) for row in db.query(
        "SELECT id, created_at, label, patch_json FROM cue_revisions WHERE track_id = ? ORDER BY id DESC LIMIT ?",
        (track_id, limit),
    )]


# --------------------------------------------------------------------------
# Speakers
# --------------------------------------------------------------------------


def _speaker_map(project_id: str) -> dict[str, str]:
    return {row["label"]: row["id"] for row in db.query(
        "SELECT id, label FROM speakers WHERE project_id = ?", (project_id,)
    )}


def ensure_speakers(project_id: str, labels: Iterable[str]) -> dict[str, str]:
    existing = _speaker_map(project_id)
    for position, label in enumerate(dict.fromkeys(label for label in labels if label)):
        if label in existing:
            continue
        speaker_id = new_id("spk")
        db.execute(
            "INSERT INTO speakers(id, project_id, label, display_name, color, created_at) VALUES (?,?,?,?,?,?)",
            (speaker_id, project_id, label, None, SPEAKER_COLORS[len(existing) % len(SPEAKER_COLORS)], now_iso()),
        )
        existing[label] = speaker_id
    return existing


def list_speakers(project_id: str) -> list[dict]:
    return [dict(row) for row in db.query(
        "SELECT * FROM speakers WHERE project_id = ? ORDER BY label", (project_id,)
    )]


def rename_speaker(speaker_id: str, display_name: str | None, color: str | None = None) -> dict:
    row = db.query_one("SELECT * FROM speakers WHERE id = ?", (speaker_id,))
    if row is None:
        raise NotFound(f"No speaker {speaker_id}")
    db.execute(
        "UPDATE speakers SET display_name = COALESCE(?, display_name), color = COALESCE(?, color) WHERE id = ?",
        (display_name, color, speaker_id),
    )
    return dict(db.query_one("SELECT * FROM speakers WHERE id = ?", (speaker_id,)))


def _touch_project(project_id: str | None) -> None:
    if project_id:
        db.execute("UPDATE projects SET updated_at = ? WHERE id = ?", (now_iso(), project_id))
