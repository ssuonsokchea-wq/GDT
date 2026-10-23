"""HTTP surface: auth, projects, tracks, cue editing, styles, jobs."""

from __future__ import annotations

import json

import pytest

API = "/api/v1"

SRT = """1
00:00:00,500 --> 00:00:02,400
hello guys welcome back

2
00:00:03,000 --> 00:00:05,500
today we are talking about ai
"""


@pytest.fixture
def srt_file(tmp_path):
    path = tmp_path / "captions.srt"
    path.write_text(SRT, encoding="utf-8")
    return path


@pytest.fixture
def project(client):
    return client.post(f"{API}/projects", json={"name": "Test project"}).json()


@pytest.fixture
def track(client, project, srt_file):
    response = client.post(
        f"{API}/subtitles/import", json={"projectId": project["id"], "path": str(srt_file)}
    )
    return response.json()["track"]


class TestAuth:
    def test_a_request_without_a_token_is_rejected(self, client):
        response = client.get(f"{API}/health", headers={"X-SF-Token": ""})
        assert response.status_code == 401

    def test_a_wrong_token_is_rejected(self, client):
        response = client.get(f"{API}/health", headers={"X-SF-Token": "guess"})
        assert response.status_code == 401
        assert response.json()["detail"]["error"]["code"] == "unauthorised"

    def test_the_root_route_needs_no_token(self, client):
        assert client.get("/", headers={"X-SF-Token": ""}).status_code == 200


class TestSystem:
    def test_health(self, client):
        assert client.get(f"{API}/health").json()["status"] == "ok"

    def test_capabilities_reports_tools_models_and_disk(self, client):
        body = client.get(f"{API}/capabilities").json()
        assert set(body) >= {"version", "platform", "paths", "disk", "tools", "encoders", "asr", "diarization"}
        assert body["disk"]["freeGb"] >= 0

    def test_models_are_listed_with_their_requirements(self, client):
        models = client.get(f"{API}/models").json()["models"]
        assert [m["name"] for m in models] == ["tiny", "base", "small", "medium", "large-v3"]
        assert all("ramGb" in m and "installed" in m for m in models)

    def test_a_setting_round_trips(self, client):
        client.put(f"{API}/settings/theme", json={"value": {"mode": "dark"}})
        assert client.get(f"{API}/settings").json()["theme"] == {"mode": "dark"}

    def test_supported_formats_cover_the_specification(self, client):
        body = client.get(f"{API}/media/supported").json()
        assert {"mp4", "mov", "mkv", "avi", "webm"} <= set(body["video"])
        assert {"mp3", "wav", "aac", "m4a"} <= {entry["id"] for entry in body["audio"]}
        assert body["subtitles"] == ["srt", "vtt", "ass"]


class TestProjects:
    def test_create_read_update_delete(self, client):
        created = client.post(f"{API}/projects", json={"name": "Episode 1"}).json()
        assert created["name"] == "Episode 1"
        assert created["settings"]["style"]["fontFamily"]

        patched = client.patch(f"{API}/projects/{created['id']}", json={"name": "Episode 2"}).json()
        assert patched["name"] == "Episode 2"

        assert any(p["id"] == created["id"] for p in client.get(f"{API}/projects").json()["projects"])
        assert client.delete(f"{API}/projects/{created['id']}").status_code == 200
        assert client.get(f"{API}/projects/{created['id']}").status_code == 404

    def test_settings_merge_rather_than_replace(self, client, project):
        client.patch(f"{API}/projects/{project['id']}", json={"settings": {"style": {"fontSize": 72}}})
        settings = client.get(f"{API}/projects/{project['id']}").json()["settings"]
        assert settings["style"]["fontSize"] == 72
        assert settings["style"]["fontFamily"] == "Arial"          # untouched
        assert settings["transcription"]["model"] == "small"       # untouched

    def test_opening_a_project_records_the_time(self, client, project):
        opened = client.post(f"{API}/projects/{project['id']}/open").json()
        assert opened["last_opened_at"]

    def test_archived_projects_are_hidden_by_default(self, client, project):
        client.patch(f"{API}/projects/{project['id']}", json={"archived": True})
        assert not any(p["id"] == project["id"] for p in client.get(f"{API}/projects").json()["projects"])
        listed = client.get(f"{API}/projects", params={"includeArchived": True}).json()["projects"]
        assert any(p["id"] == project["id"] for p in listed)

    def test_a_missing_project_is_a_404_with_a_code(self, client):
        response = client.get(f"{API}/projects/prj_nope")
        assert response.status_code == 404
        assert response.json()["error"]["code"] == "not_found"

    def test_relinking_to_a_missing_file_fails_cleanly(self, client, project):
        response = client.post(f"{API}/projects/{project['id']}/relink", json={"path": "/no/such/file.mp4"})
        assert response.status_code == 404
        assert response.json()["error"]["code"] == "file_not_found"


class TestProjectBundles:
    def test_a_bundle_round_trips_through_a_file(self, client, project, track, tmp_path):
        target = tmp_path / "project.sfproj"
        saved = client.post(
            f"{API}/projects/{project['id']}/bundle/save", params={"outputPath": str(target)}
        ).json()
        assert target.exists() and saved["sizeBytes"] > 0

        imported = client.post(f"{API}/projects/import/file", params={"path": str(target)}).json()
        assert imported["name"] == project["name"]
        assert len(imported["tracks"]) == 1
        cues = client.get(f"{API}/tracks/{imported['tracks'][0]['id']}/cues").json()["cues"]
        assert len(cues) == 2

    def test_an_unknown_bundle_version_is_refused(self, client):
        response = client.post(f"{API}/projects/import", json={"bundle": {"bundleVersion": 99}})
        assert response.status_code == 400
        assert response.json()["error"]["code"] == "bundle_version"


class TestSubtitleTracks:
    def test_import_creates_a_track_with_cues(self, client, track):
        assert track["source"] == "import"
        assert track["cue_count"] == 2

    def test_cues_are_returned_in_order_with_timings(self, client, track):
        cues = client.get(f"{API}/tracks/{track['id']}/cues").json()["cues"]
        assert [cue["idx"] for cue in cues] == [1, 2]
        assert cues[0]["startMs"] == 500 and cues[0]["endMs"] == 2400
        assert cues[0]["cps"] > 0

    def test_replacing_cues_renumbers_them(self, client, track):
        body = {"cues": [
            {"startMs": 3000, "endMs": 4000, "text": "second"},
            {"startMs": 0, "endMs": 1000, "text": "first"},
        ], "label": "manual edit"}
        cues = client.put(f"{API}/tracks/{track['id']}/cues", json=body).json()["cues"]
        assert [cue["text"] for cue in cues] == ["first", "second"]
        assert [cue["idx"] for cue in cues] == [1, 2]

    def test_patching_a_cue_resolves_the_overlap_it_creates(self, client, track):
        cues = client.get(f"{API}/tracks/{track['id']}/cues").json()["cues"]
        patched = client.patch(
            f"{API}/tracks/{track['id']}/cues/{cues[0]['id']}", json={"endMs": 4000}
        ).json()["cues"]
        assert patched[0]["endMs"] <= patched[1]["startMs"]

    def test_splitting_a_cue_produces_two(self, client, track):
        cues = client.get(f"{API}/tracks/{track['id']}/cues").json()["cues"]
        after = client.post(
            f"{API}/tracks/{track['id']}/cues/{cues[0]['id']}/split", json={"atMs": 1500}
        ).json()["cues"]
        assert len(after) == 3
        assert after[0]["endMs"] == after[1]["startMs"] == 1500

    def test_merging_cues_joins_their_text(self, client, track):
        cues = client.get(f"{API}/tracks/{track['id']}/cues").json()["cues"]
        after = client.post(
            f"{API}/tracks/{track['id']}/cues/merge",
            json={"cueIds": [cues[0]["id"], cues[1]["id"]]},
        ).json()["cues"]
        assert len(after) == 1
        assert after[0]["startMs"] == 500 and after[0]["endMs"] == 5500

    def test_merging_one_cue_is_refused(self, client, track):
        cues = client.get(f"{API}/tracks/{track['id']}/cues").json()["cues"]
        response = client.post(f"{API}/tracks/{track['id']}/cues/merge", json={"cueIds": [cues[0]["id"]]})
        assert response.status_code == 400

    def test_deleting_a_cue_renumbers_the_rest(self, client, track):
        cues = client.get(f"{API}/tracks/{track['id']}/cues").json()["cues"]
        after = client.delete(f"{API}/tracks/{track['id']}/cues/{cues[0]['id']}").json()["cues"]
        assert len(after) == 1 and after[0]["idx"] == 1

    def test_shifting_moves_every_cue(self, client, track):
        after = client.post(f"{API}/tracks/{track['id']}/shift", json={"deltaMs": 1000}).json()["cues"]
        assert after[0]["startMs"] == 1500

    def test_resegmenting_respects_tighter_line_limits(self, client, track):
        after = client.post(
            f"{API}/tracks/{track['id']}/resegment",
            json={"segmentation": {"maxCharsPerLine": 12, "maxLines": 1}},
        ).json()["cues"]
        assert len(after) > 2
        assert all(len(cue["text"]) <= 12 for cue in after)

    def test_every_commit_is_journalled(self, client, track):
        client.post(f"{API}/tracks/{track['id']}/shift", json={"deltaMs": 100})
        revisions = client.get(f"{API}/tracks/{track['id']}/revisions").json()["revisions"]
        assert any("shift" in (revision["label"] or "") for revision in revisions)

    def test_quality_report_is_served(self, client, track):
        report = client.get(f"{API}/tracks/{track['id']}/quality").json()
        assert report["cueCount"] == 2 and "issues" in report

    def test_deleting_a_track_clears_the_active_pointer(self, client, project, track):
        client.delete(f"{API}/tracks/{track['id']}")
        assert client.get(f"{API}/projects/{project['id']}").json()["active_track_id"] is None


class TestFormatsOverHttp:
    @pytest.mark.parametrize("fmt", ["srt", "vtt", "ass"])
    def test_preview_renders_each_format(self, client, track, fmt):
        body = client.get(f"{API}/tracks/{track['id']}/preview", params={"format": fmt}).json()
        assert body["format"] == fmt and body["text"]

    def test_the_vtt_preview_has_the_header(self, client, track):
        assert client.get(
            f"{API}/tracks/{track['id']}/preview", params={"format": "vtt"}
        ).json()["text"].startswith("WEBVTT")

    def test_the_ass_preview_carries_a_style_line(self, client, track):
        text = client.get(f"{API}/tracks/{track['id']}/preview", params={"format": "ass"}).json()["text"]
        assert "[V4+ Styles]" in text and "Dialogue:" in text

    def test_exporting_a_file_writes_it_and_records_it(self, client, track, tmp_path):
        target = tmp_path / "out.srt"
        job = client.post(
            f"{API}/export/subtitles", json={"trackId": track["id"], "outputPath": str(target)}
        ).json()
        assert job["type"] == "export_subtitles"
        _wait(client, job["id"])
        assert target.exists() and "-->" in target.read_text(encoding="utf-8")
        exports = client.get(f"{API}/exports").json()["exports"]
        assert exports[0]["kind"] == "srt" and exports[0]["exists"]


class TestEnhancementOverHttp:
    def test_preview_returns_the_text_and_its_changes(self, client):
        body = client.post(
            f"{API}/enhance/preview", json={"text": "hello guys welcome back today we are talking about ai"}
        ).json()
        assert body["text"] == "Hello guys, welcome back. Today we are talking about AI."
        assert body["changes"]

    def test_options_are_honoured(self, client):
        body = client.post(
            f"{API}/enhance/preview", json={"text": "um the plan", "enhancement": {"removeFillers": False}}
        ).json()
        assert "um" in body["text"].lower()

    def test_enhancing_a_track_runs_as_a_job_and_rewrites_the_cues(self, client, track):
        job = client.post(f"{API}/enhance", json={"trackId": track["id"]}).json()
        result = _wait(client, job["id"])
        assert result["status"] == "succeeded"
        assert result["result_json"]["changed"] >= 1
        cues = client.get(f"{API}/tracks/{track['id']}/cues").json()["cues"]
        assert cues[0]["text"].startswith("Hello guys,")
        assert "AI" in cues[1]["text"]


class TestStyles:
    def test_the_five_presets_are_served_and_locked(self, client):
        styles = client.get(f"{API}/styles").json()["styles"]
        presets = [style for style in styles if style["isPreset"]]
        assert {p["name"] for p in presets} == {"Netflix", "YouTube", "TikTok", "Documentary", "Minimalist"}
        response = client.delete(f"{API}/styles/{presets[0]['id']}")
        assert response.status_code == 409

    def test_a_custom_style_can_be_saved_updated_and_deleted(self, client, project):
        created = client.post(
            f"{API}/styles", json={"name": "Channel look", "projectId": project["id"], "payload": {"fontSize": 64}}
        ).json()
        assert created["payload"]["fontSize"] == 64
        again = client.post(
            f"{API}/styles", json={"name": "Channel look", "projectId": project["id"], "payload": {"fontSize": 70}}
        ).json()
        assert again["id"] == created["id"] and again["payload"]["fontSize"] == 70
        assert client.delete(f"{API}/styles/{created['id']}").status_code == 200

    def test_preview_returns_css_and_an_ass_line_from_one_model(self, client):
        body = client.post(f"{API}/styles/preview", json={"fontSize": 50, "borderStyle": "box"}).json()
        assert body["css"]["fontSize"]
        assert body["assStyleLine"].startswith("Style: Default,")
        assert body["style"]["borderStyle"] == "box"

    def test_render_presets_are_served(self, client):
        body = client.get(f"{API}/render-presets").json()
        assert len(body["presets"]) == 5 and body["defaults"]["encoder"] == "auto"


class TestJobs:
    def test_jobs_are_listed_and_fetchable(self, client, track):
        job = client.post(f"{API}/enhance", json={"trackId": track["id"]}).json()
        _wait(client, job["id"])
        assert any(j["id"] == job["id"] for j in client.get(f"{API}/jobs").json()["jobs"])
        assert client.get(f"{API}/jobs/{job['id']}").json()["type"] == "enhance"

    def test_job_events_carry_the_stages(self, client, track):
        job = client.post(f"{API}/enhance", json={"trackId": track["id"]}).json()
        _wait(client, job["id"])
        events = client.get(f"{API}/jobs/{job['id']}/events").json()["events"]
        assert isinstance(events, list)

    def test_cancelling_a_finished_job_is_harmless(self, client, track):
        job = client.post(f"{API}/enhance", json={"trackId": track["id"]}).json()
        _wait(client, job["id"])
        assert client.post(f"{API}/jobs/{job['id']}/cancel").json()["status"] == "succeeded"

    def test_an_unknown_job_is_a_404(self, client):
        assert client.get(f"{API}/jobs/job_nope").status_code == 404

    def test_a_failing_job_reports_a_coded_error(self, client, project):
        job = client.post(f"{API}/transcribe", json={"projectId": project["id"]}).json()
        result = _wait(client, job["id"])
        assert result["status"] == "failed"
        # No media in this project, so the pipeline must say exactly that.
        assert result["error_json"]["code"] == "no_media"


class TestBatches:
    def test_an_empty_batch_is_refused(self, client):
        response = client.post(f"{API}/batches", json={"operation": "transcribe", "paths": []})
        assert response.status_code == 400
        assert response.json()["error"]["code"] == "empty_batch"

    def test_an_unknown_operation_is_refused(self, client):
        response = client.post(f"{API}/batches", json={"operation": "translate", "paths": ["/a.mp4"]})
        assert response.status_code == 422

    def test_a_batch_queues_one_item_per_file(self, client, tmp_path):
        paths = []
        for name in ("a.mp4", "b.mp4"):
            path = tmp_path / name
            path.write_bytes(b"not really a video")
            paths.append(str(path))
        batch = client.post(f"{API}/batches", json={"operation": "transcribe", "paths": paths}).json()
        assert len(batch["items"]) == 2
        assert client.get(f"{API}/batches/{batch['id']}").json()["id"] == batch["id"]
        cancelled = client.post(f"{API}/batches/{batch['id']}/cancel").json()
        assert cancelled["status"] == "cancelled"


def _wait(client, job_id: str, timeout: float = 30.0) -> dict:
    """Poll a job to completion. The UI uses the event stream; tests poll."""
    import time

    deadline = time.time() + timeout
    while time.time() < deadline:
        job = client.get(f"{API}/jobs/{job_id}").json()
        if job["status"] in ("succeeded", "failed", "cancelled"):
            return job
        time.sleep(0.05)
    raise AssertionError(f"job {job_id} did not finish within {timeout}s")
