"""Subtitle tracks and cue editing.

The editor keeps its own undo stack in the renderer and commits whole-track
saves here. The endpoints below are the ones that need backend logic — split
and merge use word timings, resegment reruns the segmenter, quality runs the QC
pass — plus a plain replace for everything the renderer can compute itself.
"""

from __future__ import annotations

from fastapi import APIRouter, HTTPException

from ..core import db
from ..core.jobs import manager
from ..models.schemas import (
    CuePatch,
    CuesReplace,
    EnhancePreview,
    EnhanceRequest,
    ExportSubtitlesRequest,
    ImportSubtitlesRequest,
    MergeRequest,
    RenderRequest,
    ResegmentRequest,
    ShiftRequest,
    SplitRequest,
    TrackCreate,
    TrackPatch,
    TranscribeRequest,
)
from ..services import (
    enhance as enhance_service,
    projects as project_service,
    segmentation as seg_service,
    subtitles as subtitle_service,
    tracks as track_service,
)

router = APIRouter(tags=["subtitles"])


def _not_found(message: str):
    return HTTPException(status_code=404, detail={"error": {"code": "not_found", "message": message}})


# --------------------------------------------------------------------------
# Tracks
# --------------------------------------------------------------------------


@router.post("/tracks")
def create_track(body: TrackCreate) -> dict:
    return track_service.create_track(body.projectId, name=body.name, language=body.language, source=body.source)


@router.get("/tracks/{track_id}")
def get_track(track_id: str, withCues: bool = False, withWords: bool = False) -> dict:
    track = track_service.get_track(track_id)
    if withCues:
        cues = track_service.load_cues(track_id, with_words=withWords)
        track["cues"] = [cue.to_dict() for cue in cues]
    return track


@router.patch("/tracks/{track_id}")
def patch_track(track_id: str, body: TrackPatch) -> dict:
    patch = body.model_dump(exclude_none=True)
    if "styleId" in patch:
        patch["style_id"] = patch.pop("styleId")
    if "enhanced" in patch:
        patch["enhanced"] = 1 if patch["enhanced"] else 0
    return track_service.update_track(track_id, patch)


@router.delete("/tracks/{track_id}")
def delete_track(track_id: str) -> dict:
    track_service.delete_track(track_id)
    return {"deleted": track_id}


@router.get("/tracks/{track_id}/cues")
def list_cues(track_id: str, withWords: bool = False) -> dict:
    cues = track_service.load_cues(track_id, with_words=withWords)
    return {"trackId": track_id, "cues": [cue.to_dict() for cue in cues]}


@router.put("/tracks/{track_id}/cues")
def replace_cues(track_id: str, body: CuesReplace) -> dict:
    cues = [subtitle_service.Cue.from_dict(cue.model_dump()) for cue in body.cues]
    labels = {cue.speaker for cue in cues if cue.speaker}
    track = track_service.get_track(track_id)
    speaker_ids = track_service.ensure_speakers(track["project_id"], labels)
    saved = track_service.save_cues(track_id, cues, label=body.label, speaker_ids=speaker_ids)
    return {"trackId": track_id, "cues": [cue.to_dict() for cue in saved]}


@router.patch("/tracks/{track_id}/cues/{cue_id}")
def patch_cue(track_id: str, cue_id: str, body: CuePatch) -> dict:
    cues = track_service.load_cues(track_id, with_words=True)
    target = next((cue for cue in cues if cue.id == cue_id), None)
    if target is None:
        raise _not_found(f"No cue {cue_id}")
    patch = body.model_dump(exclude_none=True)
    if "startMs" in patch:
        target.start_ms = max(0, int(patch["startMs"]))
    if "endMs" in patch:
        target.end_ms = max(target.start_ms, int(patch["endMs"]))
    if "text" in patch:
        target.text = patch["text"]
    if "speaker" in patch:
        target.speaker = patch["speaker"]
    if "locked" in patch:
        target.locked = bool(patch["locked"])
    if "styleOverride" in patch:
        target.style_override = patch["styleOverride"]
    saved = track_service.save_cues(track_id, subtitle_service.resolve_overlaps(cues), label="edit cue")
    return {"trackId": track_id, "cues": [cue.to_dict() for cue in saved]}


@router.delete("/tracks/{track_id}/cues/{cue_id}")
def delete_cue(track_id: str, cue_id: str) -> dict:
    cues = [cue for cue in track_service.load_cues(track_id, with_words=True) if cue.id != cue_id]
    saved = track_service.save_cues(track_id, cues, label="delete cue")
    return {"trackId": track_id, "cues": [cue.to_dict() for cue in saved]}


@router.post("/tracks/{track_id}/cues/{cue_id}/split")
def split_cue(track_id: str, cue_id: str, body: SplitRequest) -> dict:
    cues = track_service.load_cues(track_id, with_words=True)
    target = next((cue for cue in cues if cue.id == cue_id), None)
    if target is None:
        raise _not_found(f"No cue {cue_id}")
    left, right = subtitle_service.split_cue(target, body.atMs, body.atChar)
    position = cues.index(target)
    cues[position : position + 1] = [left, right]
    saved = track_service.save_cues(track_id, cues, label="split cue")
    return {"trackId": track_id, "cues": [cue.to_dict() for cue in saved]}


@router.post("/tracks/{track_id}/cues/merge")
def merge(track_id: str, body: MergeRequest) -> dict:
    cues = track_service.load_cues(track_id, with_words=True)
    selected = [cue for cue in cues if cue.id in set(body.cueIds)]
    if len(selected) < 2:
        raise HTTPException(
            status_code=400,
            detail={"error": {"code": "merge_needs_two", "message": "Select at least two cues to merge"}},
        )
    merged = subtitle_service.merge_cues(selected, body.separator)
    first = min(cues.index(cue) for cue in selected)
    remaining = [cue for cue in cues if cue.id not in set(body.cueIds)]
    remaining.insert(min(first, len(remaining)), merged)
    saved = track_service.save_cues(track_id, remaining, label="merge cues")
    return {"trackId": track_id, "cues": [cue.to_dict() for cue in saved]}


@router.post("/tracks/{track_id}/shift")
def shift(track_id: str, body: ShiftRequest) -> dict:
    cues = track_service.load_cues(track_id, with_words=True)
    saved = track_service.save_cues(
        track_id, subtitle_service.shift(cues, body.deltaMs, from_ms=body.fromMs), label=f"shift {body.deltaMs} ms"
    )
    return {"trackId": track_id, "cues": [cue.to_dict() for cue in saved]}


@router.post("/tracks/{track_id}/resegment")
def resegment(track_id: str, body: ResegmentRequest) -> dict:
    track = track_service.get_track(track_id)
    project = project_service.get_project(track["project_id"])
    style = (project.get("settings") or {}).get("style") or {}
    defaults = {"maxCharsPerLine": style.get("maxCharsPerLine", 42), "maxLines": style.get("maxLines", 2)}
    options = seg_service.SegmentOptions.from_dict({**defaults, **(body.segmentation or {})})
    cues = track_service.load_cues(track_id, with_words=True)
    saved = track_service.save_cues(track_id, seg_service.resegment(cues, options), label="resegment")
    return {"trackId": track_id, "cues": [cue.to_dict() for cue in saved]}


@router.get("/tracks/{track_id}/quality")
def quality(track_id: str) -> dict:
    return subtitle_service.quality_report(track_service.load_cues(track_id))


@router.get("/tracks/{track_id}/revisions")
def revisions(track_id: str, limit: int = 50) -> dict:
    return {"revisions": track_service.revisions(track_id, limit)}


@router.get("/tracks/{track_id}/preview")
def preview(track_id: str, format: str = "srt") -> dict:
    """The serialised track as text, for the export dialog's preview pane."""
    track = track_service.get_track(track_id)
    project = project_service.get_project(track["project_id"])
    cues = track_service.load_cues(track_id)
    media = project.get("media") or {}
    body = subtitle_service.write(
        cues, format,
        style=(project.get("settings") or {}).get("style"),
        play_res=(media.get("width") or 1920, media.get("height") or 1080),
        title=project["name"],
    )
    return {"format": format, "text": body[:200000], "truncated": len(body) > 200000}


# --------------------------------------------------------------------------
# Import, enhancement, export, render — all long-running except import
# --------------------------------------------------------------------------


@router.post("/subtitles/import")
def import_subtitles(body: ImportSubtitlesRequest) -> dict:
    cues = subtitle_service.read_file(body.path)
    track = track_service.create_track(
        body.projectId,
        name=body.name or "Imported",
        language=body.language,
        source="import",
    )
    labels = {cue.speaker for cue in cues if cue.speaker}
    speaker_ids = track_service.ensure_speakers(body.projectId, labels)
    saved = track_service.save_cues(track["id"], cues, label="imported", speaker_ids=speaker_ids)
    return {"track": track_service.get_track(track["id"]), "cueCount": len(saved)}


@router.post("/transcribe")
def transcribe(body: TranscribeRequest) -> dict:
    return manager.submit("transcribe", body.model_dump(), project_id=body.projectId, priority=50)


@router.post("/enhance")
def enhance(body: EnhanceRequest) -> dict:
    track = track_service.get_track(body.trackId)
    return manager.submit("enhance", body.model_dump(), project_id=track["project_id"], priority=40)


@router.post("/enhance/preview")
def enhance_preview(body: EnhancePreview) -> dict:
    """Run the enhancer on one string, synchronously.

    The settings panel calls this as the user toggles options so they can see
    exactly what each rule does to their own text before committing a track.
    """
    options = enhance_service.EnhanceOptions.from_dict(body.enhancement)
    return enhance_service.enhance_text(body.text, options).to_dict()


@router.post("/export/subtitles")
def export_subtitles(body: ExportSubtitlesRequest) -> dict:
    track = track_service.get_track(body.trackId)
    return manager.submit("export_subtitles", body.model_dump(), project_id=track["project_id"], priority=30)


@router.post("/render")
def render(body: RenderRequest) -> dict:
    track = track_service.get_track(body.trackId)
    return manager.submit("render", body.model_dump(), project_id=track["project_id"], priority=80)


@router.post("/render/plan")
def render_plan(body: RenderRequest) -> dict:
    """What the render will do, without doing it: encoder, size, ETA."""
    from ..services import burn as burn_service

    track = track_service.get_track(body.trackId)
    project = project_service.get_project(track["project_id"])
    if not project.get("media"):
        raise HTTPException(status_code=400, detail={"error": {"code": "no_media", "message": "No video in this project"}})
    cues = track_service.load_cues(body.trackId)
    style = {**((project.get("settings") or {}).get("style") or {}), **(body.style or {})}
    options = {**((project.get("settings") or {}).get("render") or {}), **(body.render or {})}
    plan = burn_service.plan_burn(project["media"], cues, style, options, output_path=body.outputPath)
    return plan.to_dict()


@router.get("/exports")
def list_exports(projectId: str | None = None, limit: int = 50) -> dict:
    sql = "SELECT * FROM exports"
    params: tuple = ()
    if projectId:
        sql += " WHERE project_id = ?"
        params = (projectId,)
    sql += " ORDER BY created_at DESC LIMIT ?"
    params = (*params, limit)
    from pathlib import Path as _Path

    rows = [db.row_to_dict(row, ("settings_json",)) for row in db.query(sql, params)]
    for row in rows:
        row["exists"] = _Path(row["path"]).exists() if row else False
    return {"exports": rows}
