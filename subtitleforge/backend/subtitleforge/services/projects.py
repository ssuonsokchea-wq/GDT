"""Projects: the unit a user opens, saves and reopens.

A project is a pointer to a video plus everything the user decided about it —
tracks, cues, speakers, style, export settings. The video itself is never
copied; 4K footage is too large to duplicate and users expect their media to
stay where they put it. The cost of that choice is moved media, which
:func:`relink` exists to repair.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from ..core import db
from ..core.clock import now_iso
from ..core.errors import AppError, NotFound
from ..core.ids import new_id
from . import tracks
from .styles import DEFAULT_STYLE, normalise_style
from .subtitles import Cue

PROJECT_JSON_FIELDS = ("settings_json",)

DEFAULT_SETTINGS: dict[str, Any] = {
    "style": DEFAULT_STYLE,
    "transcription": {"model": "small", "device": "auto", "language": "en", "vadFilter": True, "diarize": False},
    "segmentation": {"maxCharsPerLine": 42, "maxLines": 2, "targetCps": 17.0},
    "enhancement": {"restorePunctuation": True, "fixCapitalization": True, "removeFillers": True, "fixGrammar": True},
    "render": {"presetName": "Web 1080p", "encoder": "auto", "allowHardware": True, "audio": "copy"},
}


def create_project(name: str | None = None, media_path: str | None = None, settings: dict | None = None) -> dict:
    project_id = new_id("prj")
    display_name = name or (Path(media_path).stem if media_path else "Untitled project")
    merged = _merge_settings(settings)
    db.execute(
        "INSERT INTO projects(id, name, settings_json, created_at, updated_at, last_opened_at) VALUES (?,?,?,?,?,?)",
        (project_id, display_name, json.dumps(merged), now_iso(), now_iso(), now_iso()),
    )
    if media_path:
        from . import media as media_service

        media_service.register_media(media_path, project_id)
    return get_project(project_id)


def _merge_settings(settings: dict | None) -> dict:
    merged = json.loads(json.dumps(DEFAULT_SETTINGS))
    for key, value in (settings or {}).items():
        if isinstance(value, dict) and isinstance(merged.get(key), dict):
            merged[key].update(value)
        else:
            merged[key] = value
    merged["style"] = normalise_style(merged.get("style"))
    return merged


def get_project(project_id: str, *, full: bool = False) -> dict:
    row = db.query_one("SELECT * FROM projects WHERE id = ?", (project_id,))
    if row is None:
        raise NotFound(f"No project {project_id}")
    project = db.row_to_dict(row, PROJECT_JSON_FIELDS)
    assert project is not None
    project["settings"] = project.pop("settings_json") or {}
    media_row = db.query_one("SELECT * FROM media_files WHERE id = ?", (project.get("media_id"),)) if project.get("media_id") else None
    project["media"] = db.row_to_dict(media_row, ("probe_json",)) if media_row else None
    if project["media"]:
        project["media"]["exists"] = Path(project["media"]["path"]).exists()
    project["tracks"] = tracks.list_tracks(project_id)
    project["speakers"] = tracks.list_speakers(project_id)
    if full and project.get("active_track_id"):
        project["cues"] = [cue.to_dict() for cue in tracks.load_cues(project["active_track_id"])]
    return project


def list_projects(*, include_archived: bool = False, limit: int = 100) -> list[dict]:
    sql = "SELECT p.*, m.path AS media_path, m.filename AS media_filename, m.duration_ms, m.width, m.height," \
          " m.poster_path FROM projects p LEFT JOIN media_files m ON m.id = p.media_id"
    if not include_archived:
        sql += " WHERE p.archived = 0"
    sql += " ORDER BY COALESCE(p.last_opened_at, p.updated_at) DESC LIMIT ?"
    out = []
    for row in db.query(sql, (limit,)):
        project = db.row_to_dict(row, PROJECT_JSON_FIELDS)
        assert project is not None
        project["settings"] = project.pop("settings_json") or {}
        project["mediaExists"] = Path(project["media_path"]).exists() if project.get("media_path") else False
        out.append(project)
    return out


def update_project(project_id: str, patch: dict) -> dict:
    project = get_project(project_id)
    name = patch.get("name")
    notes = patch.get("notes")
    archived = patch.get("archived")
    active_track_id = patch.get("activeTrackId") or patch.get("active_track_id")
    settings = patch.get("settings")
    if settings is not None:
        merged = project["settings"] or {}
        for key, value in settings.items():
            if isinstance(value, dict) and isinstance(merged.get(key), dict):
                merged[key].update(value)
            else:
                merged[key] = value
        if "style" in merged:
            merged["style"] = normalise_style(merged["style"])
        db.execute("UPDATE projects SET settings_json = ? WHERE id = ?", (json.dumps(merged), project_id))
    assignments, params = [], []
    for column, value in (("name", name), ("notes", notes), ("active_track_id", active_track_id)):
        if value is not None:
            assignments.append(f"{column} = ?")
            params.append(value)
    if archived is not None:
        assignments.append("archived = ?")
        params.append(1 if archived else 0)
    if assignments:
        db.execute(
            f"UPDATE projects SET {', '.join(assignments)}, updated_at = ? WHERE id = ?",
            (*params, now_iso(), project_id),
        )
    else:
        db.execute("UPDATE projects SET updated_at = ? WHERE id = ?", (now_iso(), project_id))
    return get_project(project_id)


def open_project(project_id: str) -> dict:
    db.execute("UPDATE projects SET last_opened_at = ? WHERE id = ?", (now_iso(), project_id))
    return get_project(project_id, full=True)


def delete_project(project_id: str, *, delete_cache: bool = True) -> None:
    project = get_project(project_id)
    if delete_cache and project.get("media_id"):
        from .media import clear_cache

        clear_cache(project["media_id"])
    db.execute("DELETE FROM projects WHERE id = ?", (project_id,))


def duplicate_project(project_id: str, name: str | None = None) -> dict:
    source = get_project(project_id)
    clone = create_project(
        name or f"{source['name']} copy",
        source["media"]["path"] if source.get("media") else None,
        source.get("settings"),
    )
    for track in source["tracks"]:
        new_track = tracks.create_track(
            clone["id"], name=track["name"], language=track["language"], source=track["source"], model=track["model"]
        )
        cues = tracks.load_cues(track["id"], with_words=True)
        for cue in cues:
            cue.id = None
        labels = {cue.speaker for cue in cues if cue.speaker}
        speaker_ids = tracks.ensure_speakers(clone["id"], labels)
        tracks.save_cues(new_track["id"], cues, label="duplicated", speaker_ids=speaker_ids)
    return get_project(clone["id"])


def relink(project_id: str, new_path: str) -> dict:
    """Point a project at media that moved, keeping every cue and edit."""
    project = get_project(project_id)
    if not Path(new_path).exists():
        raise AppError(f"File not found: {new_path}", code="file_not_found", status=404)
    from . import media as media_service

    new_media = media_service.register_media(new_path, project_id)
    old = project.get("media")
    if old and old.get("duration_ms") and new_media.get("duration_ms"):
        drift = abs(old["duration_ms"] - new_media["duration_ms"])
        if drift > 1000:
            # Keep the edits but say so plainly: a different cut will not line up.
            db.put_setting(
                f"relink_warning:{project_id}",
                {"driftMs": drift, "at": now_iso(), "oldPath": old["path"], "newPath": new_path},
            )
    return get_project(project_id)


# --------------------------------------------------------------------------
# Portable project files
# --------------------------------------------------------------------------

BUNDLE_VERSION = 1


def export_bundle(project_id: str) -> dict:
    """A self-contained JSON description of the project, minus the video.

    This is what a ``.sfproj`` file holds: enough to reopen the work on another
    machine that has the same footage, and small enough to keep in version
    control beside a script.
    """
    project = get_project(project_id)
    payload = {
        "bundleVersion": BUNDLE_VERSION,
        "exportedAt": now_iso(),
        "project": {
            "name": project["name"],
            "notes": project.get("notes"),
            "settings": project.get("settings"),
        },
        "media": {
            "path": project["media"]["path"] if project.get("media") else None,
            "filename": project["media"]["filename"] if project.get("media") else None,
            "durationMs": project["media"]["duration_ms"] if project.get("media") else None,
            "width": project["media"]["width"] if project.get("media") else None,
            "height": project["media"]["height"] if project.get("media") else None,
            "fps": project["media"]["fps"] if project.get("media") else None,
        },
        "speakers": [
            {"label": s["label"], "displayName": s["display_name"], "color": s["color"]}
            for s in project.get("speakers", [])
        ],
        "tracks": [],
    }
    for track in project["tracks"]:
        cues = tracks.load_cues(track["id"], with_words=True)
        payload["tracks"].append(
            {
                "name": track["name"],
                "language": track["language"],
                "source": track["source"],
                "model": track["model"],
                "enhanced": bool(track["enhanced"]),
                "isActive": track["id"] == project.get("active_track_id"),
                "cues": [cue.to_dict() for cue in cues],
            }
        )
    return payload


def import_bundle(payload: dict, *, media_path: str | None = None) -> dict:
    if payload.get("bundleVersion") != BUNDLE_VERSION:
        raise AppError(
            f"Unsupported project file version: {payload.get('bundleVersion')}",
            code="bundle_version",
            hint="This file was written by a different version of SubtitleForge.",
        )
    meta = payload.get("project", {})
    source_media = media_path or (payload.get("media") or {}).get("path")
    exists = bool(source_media and Path(source_media).exists())
    project = create_project(meta.get("name") or "Imported project", source_media if exists else None, meta.get("settings"))
    if meta.get("notes"):
        update_project(project["id"], {"notes": meta["notes"]})
    labels = [s["label"] for s in payload.get("speakers", [])]
    speaker_ids = tracks.ensure_speakers(project["id"], labels)
    for speaker in payload.get("speakers", []):
        if speaker.get("displayName") or speaker.get("color"):
            tracks.rename_speaker(speaker_ids[speaker["label"]], speaker.get("displayName"), speaker.get("color"))
    active_id = None
    for track_payload in payload.get("tracks", []):
        track = tracks.create_track(
            project["id"],
            name=track_payload.get("name") or "Imported",
            language=track_payload.get("language") or "en",
            source=track_payload.get("source") or "import",
            model=track_payload.get("model"),
        )
        cues = [Cue.from_dict(item) for item in track_payload.get("cues", [])]
        for cue in cues:
            cue.id = None
        more = tracks.ensure_speakers(project["id"], [c.speaker for c in cues if c.speaker])
        tracks.save_cues(track["id"], cues, label="imported", speaker_ids={**speaker_ids, **more})
        tracks.update_track(track["id"], {"enhanced": 1 if track_payload.get("enhanced") else 0})
        if track_payload.get("isActive") or active_id is None:
            active_id = track["id"]
    if active_id:
        update_project(project["id"], {"activeTrackId": active_id})
    result = get_project(project["id"])
    result["mediaMissing"] = not exists
    return result
