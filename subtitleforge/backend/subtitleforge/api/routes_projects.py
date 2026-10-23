"""Projects, styles, speakers and the portable project file."""

from __future__ import annotations

import json
from pathlib import Path

from fastapi import APIRouter, HTTPException

from ..core import db
from ..core.clock import now_iso
from ..core.ids import new_id
from ..models.schemas import ProjectCreate, ProjectImport, ProjectPatch, RelinkRequest, SpeakerPatch, StyleUpsert
from ..services import projects as project_service, styles as style_service, tracks as track_service

router = APIRouter(tags=["projects"])


@router.get("/projects")
def list_projects(includeArchived: bool = False, limit: int = 100) -> dict:
    return {"projects": project_service.list_projects(include_archived=includeArchived, limit=limit)}


@router.post("/projects")
def create_project(body: ProjectCreate) -> dict:
    return project_service.create_project(body.name, body.mediaPath, body.settings)


@router.get("/projects/{project_id}")
def get_project(project_id: str, full: bool = False) -> dict:
    return project_service.get_project(project_id, full=full)


@router.post("/projects/{project_id}/open")
def open_project(project_id: str) -> dict:
    return project_service.open_project(project_id)


@router.patch("/projects/{project_id}")
def patch_project(project_id: str, body: ProjectPatch) -> dict:
    return project_service.update_project(project_id, body.model_dump(exclude_none=True))


@router.delete("/projects/{project_id}")
def delete_project(project_id: str, deleteCache: bool = True) -> dict:
    project_service.delete_project(project_id, delete_cache=deleteCache)
    return {"deleted": project_id}


@router.post("/projects/{project_id}/duplicate")
def duplicate_project(project_id: str, name: str | None = None) -> dict:
    return project_service.duplicate_project(project_id, name)


@router.post("/projects/{project_id}/relink")
def relink(project_id: str, body: RelinkRequest) -> dict:
    return project_service.relink(project_id, body.path)


@router.get("/projects/{project_id}/bundle")
def export_bundle(project_id: str) -> dict:
    return project_service.export_bundle(project_id)


@router.post("/projects/{project_id}/bundle/save")
def save_bundle(project_id: str, outputPath: str) -> dict:
    payload = project_service.export_bundle(project_id)
    target = Path(outputPath)
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    return {"path": str(target), "sizeBytes": target.stat().st_size}


@router.post("/projects/import")
def import_bundle(body: ProjectImport) -> dict:
    return project_service.import_bundle(body.bundle, media_path=body.mediaPath)


@router.post("/projects/import/file")
def import_bundle_file(path: str, mediaPath: str | None = None) -> dict:
    source = Path(path)
    if not source.exists():
        raise HTTPException(status_code=404, detail={"error": {"code": "file_not_found", "message": str(source)}})
    payload = json.loads(source.read_text(encoding="utf-8"))
    return project_service.import_bundle(payload, media_path=mediaPath)


# --------------------------------------------------------------------------
# Speakers
# --------------------------------------------------------------------------


@router.get("/projects/{project_id}/speakers")
def list_speakers(project_id: str) -> dict:
    return {"speakers": track_service.list_speakers(project_id)}


@router.patch("/speakers/{speaker_id}")
def patch_speaker(speaker_id: str, body: SpeakerPatch) -> dict:
    return track_service.rename_speaker(speaker_id, body.displayName, body.color)


# --------------------------------------------------------------------------
# Styles
# --------------------------------------------------------------------------


@router.get("/styles")
def list_styles(projectId: str | None = None) -> dict:
    rows = db.query(
        "SELECT * FROM subtitle_styles WHERE is_preset = 1 OR project_id = ? ORDER BY is_preset DESC, name",
        (projectId,),
    )
    return {
        "styles": [
            {
                "id": row["id"],
                "name": row["name"],
                "projectId": row["project_id"],
                "isPreset": bool(row["is_preset"]),
                "payload": json.loads(row["payload_json"]),
            }
            for row in rows
        ],
        "defaults": style_service.DEFAULT_STYLE,
    }


@router.post("/styles")
def upsert_style(body: StyleUpsert) -> dict:
    payload = style_service.normalise_style({**body.payload, "name": body.name})
    existing = db.query_one(
        "SELECT id FROM subtitle_styles WHERE name = ? AND is_preset = 0 AND project_id IS ?",
        (body.name, body.projectId),
    )
    style_id = existing["id"] if existing else new_id("sty")
    if existing:
        db.execute(
            "UPDATE subtitle_styles SET payload_json = ?, updated_at = ? WHERE id = ?",
            (json.dumps(payload), now_iso(), style_id),
        )
    else:
        db.execute(
            "INSERT INTO subtitle_styles(id, project_id, name, is_preset, payload_json, created_at, updated_at)"
            " VALUES (?,?,?,0,?,?,?)",
            (style_id, body.projectId, body.name, json.dumps(payload), now_iso(), now_iso()),
        )
    return {"id": style_id, "name": body.name, "payload": payload}


@router.delete("/styles/{style_id}")
def delete_style(style_id: str) -> dict:
    row = db.query_one("SELECT is_preset FROM subtitle_styles WHERE id = ?", (style_id,))
    if row is None:
        raise HTTPException(status_code=404, detail={"error": {"code": "not_found", "message": style_id}})
    if row["is_preset"]:
        raise HTTPException(
            status_code=409,
            detail={"error": {"code": "preset_locked", "message": "Shipped presets cannot be deleted. Duplicate it instead."}},
        )
    db.execute("DELETE FROM subtitle_styles WHERE id = ?", (style_id,))
    return {"deleted": style_id}


@router.post("/styles/preview")
def style_preview(payload: dict, containerHeight: int = 1080) -> dict:
    """The style as CSS for the overlay, and as an ASS style line.

    Returning both from one place is how the preview and the burn-in stay
    identical: there is exactly one translation of the style model, and the
    renderer never invents its own.
    """
    normalised = style_service.normalise_style(payload)
    return {
        "style": normalised,
        "css": style_service.to_css(normalised, containerHeight),
        "assStyleLine": style_service.ass_style_line("Default", normalised, (1920, containerHeight)),
    }


@router.get("/render-presets")
def render_presets() -> dict:
    from ..services import render_presets as presets

    return {"presets": presets.RENDER_PRESETS, "defaults": presets.DEFAULT_RENDER}
