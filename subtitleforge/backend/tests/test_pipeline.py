"""Integration: real FFmpeg, real files, real burned pixels.

These tests build a tiny video with FFmpeg's own synthetic sources, so they
need no fixtures on disk and run in a couple of seconds. They are skipped when
FFmpeg is unavailable rather than failing, because a contributor without it can
still work on everything else.
"""

from __future__ import annotations

import shutil
import subprocess
from pathlib import Path

import pytest

from subtitleforge.services import burn as burn_service
from subtitleforge.services import ffmpeg, media as media_service
from subtitleforge.services.subtitles import Cue

pytestmark = pytest.mark.skipif(
    not (shutil.which("ffmpeg") and shutil.which("ffprobe")), reason="FFmpeg is not installed"
)


@pytest.fixture
def video(tmp_path: Path) -> Path:
    """Four seconds of 640x360 colour bars with a 440 Hz tone."""
    target = tmp_path / "clip.mp4"
    subprocess.run(
        [
            "ffmpeg", "-y", "-loglevel", "error",
            "-f", "lavfi", "-i", "testsrc=size=640x360:rate=25:duration=4",
            "-f", "lavfi", "-i", "sine=frequency=440:duration=4",
            "-c:v", "libx264", "-preset", "ultrafast", "-c:a", "aac", "-shortest", str(target),
        ],
        check=True,
    )
    return target


@pytest.fixture
def silent_video(tmp_path: Path) -> Path:
    target = tmp_path / "silent.mp4"
    subprocess.run(
        ["ffmpeg", "-y", "-loglevel", "error", "-f", "lavfi", "-i", "testsrc=size=320x240:rate=10:duration=2",
         "-c:v", "libx264", "-preset", "ultrafast", str(target)],
        check=True,
    )
    return target


CUES = [
    Cue(start_ms=200, end_ms=1800, text="First caption"),
    Cue(start_ms=2000, end_ms=3800, text="Second caption"),
]


class TestProbing:
    def test_every_property_the_import_panel_shows(self, video):
        info = ffmpeg.media_info(video)
        assert info.width == 640 and info.height == 360
        assert info.fps == pytest.approx(25.0, abs=0.01)
        assert 3800 <= (info.duration_ms or 0) <= 4200
        assert info.video_codec == "h264" and info.audio_codec == "aac"
        assert info.has_audio is True
        assert info.size_bytes and info.size_bytes > 0

    def test_a_missing_file_is_a_clean_error(self, settings):
        from subtitleforge.core.errors import AppError

        with pytest.raises(AppError) as caught:
            ffmpeg.media_info("/no/such/file.mp4")
        assert caught.value.code == "file_not_found"

    def test_a_file_that_is_not_video_is_rejected_with_a_hint(self, settings, tmp_path):
        from subtitleforge.core.errors import UnsupportedMedia

        bogus = tmp_path / "notes.mp4"
        bogus.write_text("this is not a video", encoding="utf-8")
        with pytest.raises(UnsupportedMedia) as caught:
            ffmpeg.media_info(bogus)
        assert caught.value.hint

    def test_video_without_audio_is_refused_for_transcription(self, settings, silent_video):
        from subtitleforge.core.errors import UnsupportedMedia

        with pytest.raises(UnsupportedMedia) as caught:
            media_service.register_media(silent_video)
        assert caught.value.code == "no_audio"

    def test_registration_stores_the_properties(self, settings, video):
        record = media_service.register_media(video)
        assert record["width"] == 640 and record["fps"] == pytest.approx(25.0, abs=0.01)
        assert record["probe_json"]["streams"]

    def test_registering_twice_in_a_project_reuses_the_row(self, settings, video):
        from subtitleforge.services import projects as project_service

        project = project_service.create_project("P")
        first = media_service.register_media(video, project["id"])
        second = media_service.register_media(video, project["id"])
        assert first["id"] == second["id"]


class TestAudioExtraction:
    def test_asr_audio_is_mono_sixteen_kilohertz(self, settings, video):
        media = media_service.register_media(video)
        audio = media_service.extract_audio(media["id"], "wav", purpose="asr")
        assert Path(audio["path"]).exists()
        assert audio["sample_rate"] == 16000 and audio["channels"] == 1

    @pytest.mark.parametrize("fmt", ["wav", "mp3", "aac", "m4a"])
    def test_every_specified_format_extracts(self, settings, video, fmt):
        media = media_service.register_media(video)
        audio = media_service.extract_audio(media["id"], fmt, purpose="export")
        assert Path(audio["path"]).exists() and Path(audio["path"]).stat().st_size > 0

    def test_an_unknown_format_is_refused(self, settings, video):
        from subtitleforge.core.errors import AppError

        media = media_service.register_media(video)
        with pytest.raises(AppError):
            media_service.extract_audio(media["id"], "ogg")

    def test_progress_runs_to_completion(self, settings, video):
        media = media_service.register_media(video)
        seen: list[float] = []
        media_service.extract_audio(media["id"], "wav", purpose="export", progress=lambda f, s: seen.append(f))
        assert seen and seen[-1] == pytest.approx(1.0)


class TestDerivedAssets:
    def test_a_poster_frame_is_written_once_and_cached(self, settings, video):
        media = media_service.register_media(video)
        first = media_service.poster_frame(media["id"], at_ms=1000, width=320)
        stamp = Path(first).stat().st_mtime_ns
        second = media_service.poster_frame(media["id"], at_ms=1000, width=320)
        assert first == second and Path(second).stat().st_mtime_ns == stamp

    def test_waveform_peaks_cover_the_duration(self, settings, video):
        media = media_service.register_media(video)
        peaks = media_service.waveform_peaks(media["id"], buckets=100)
        assert 95 <= peaks["buckets"] <= 105
        assert all(-1.0 <= low <= high <= 1.0 for low, high in peaks["peaks"])
        assert peaks["msPerBucket"] > 0

    def test_a_tone_produces_a_non_silent_waveform(self, settings, video):
        media = media_service.register_media(video)
        peaks = media_service.waveform_peaks(media["id"], buckets=50)
        assert max(high for _, high in peaks["peaks"]) > 0.05

    def test_clearing_the_cache_frees_derived_files_only(self, settings, video):
        media = media_service.register_media(video)
        media_service.extract_audio(media["id"], "wav", purpose="asr")
        result = media_service.clear_cache(media["id"])
        assert result["removed"] >= 1 and result["freedBytes"] > 0
        assert Path(video).exists()      # the source is never touched


class TestBurnIn:
    def test_the_output_is_a_playable_video_with_the_expected_size(self, settings, video):
        media = media_service.register_media(video)
        result = burn_service.burn(media, CUES, {"fontSize": 48}, {"presetName": "Draft", "allowHardware": False})
        output = Path(result["output_path"])
        assert output.exists() and output.stat().st_size > 0
        info = ffmpeg.media_info(output)
        assert info.width == 640 and info.height == 360
        assert info.has_audio

    def test_captions_change_the_pixels_where_they_are_drawn(self, settings, video, tmp_path):
        media = media_service.register_media(video)
        result = burn_service.burn(media, CUES, {"fontSize": 56}, {"presetName": "Draft", "allowHardware": False})
        before = _frame(video, 1.0, tmp_path / "before.png")
        after = _frame(result["output_path"], 1.0, tmp_path / "after.png")
        assert _max_difference(before, after) > 20      # the caption is visibly there

    def test_a_height_cap_scales_the_output(self, settings, video):
        media = media_service.register_media(video)
        result = burn_service.burn(
            media, CUES, {}, {"presetName": "Draft", "maxHeight": 180, "allowHardware": False}
        )
        info = ffmpeg.media_info(result["output_path"])
        assert info.height == 180

    def test_vertical_output_is_padded_not_cropped(self, settings, video):
        media = media_service.register_media(video)
        result = burn_service.burn(
            media, CUES, {}, {"presetName": "Draft", "aspect": "9:16", "maxHeight": 640, "allowHardware": False}
        )
        info = ffmpeg.media_info(result["output_path"])
        assert (info.width, info.height) == (360, 640)

    def test_audio_can_be_dropped(self, settings, video):
        media = media_service.register_media(video)
        result = burn_service.burn(
            media, CUES, {}, {"presetName": "Draft", "audio": "none", "allowHardware": False}
        )
        assert ffmpeg.media_info(result["output_path"]).has_audio is False

    def test_an_empty_track_is_refused_before_encoding(self, settings, video):
        from subtitleforge.core.errors import AppError

        media = media_service.register_media(video)
        with pytest.raises(AppError) as caught:
            burn_service.burn(media, [], {}, {})
        assert caught.value.code == "empty_track"

    def test_a_cancelled_render_leaves_no_half_written_file(self, settings, video):
        from subtitleforge.core.errors import JobCancelled

        media = media_service.register_media(video)
        target = Path(video).with_name("cancelled.mp4")
        with pytest.raises(JobCancelled):
            burn_service.burn(
                media, CUES, {}, {"presetName": "Master 4K", "allowHardware": False},
                output_path=target, should_cancel=lambda: True,
            )
        assert not target.exists()

    def test_the_plan_describes_the_render_before_it_runs(self, settings, video):
        media = media_service.register_media(video)
        plan = burn_service.plan_burn(media, CUES, {}, {"presetName": "Web 1080p", "allowHardware": False})
        assert plan.encoder == "libx264" and plan.hardware is False
        assert plan.output_path.endswith("_subtitled.mp4")
        assert plan.estimated_seconds is not None
        assert Path(plan.args[-1]) == Path(plan.output_path)

    def test_the_style_file_written_for_libass_is_valid_ass(self, settings, video, tmp_path):
        media = media_service.register_media(video)
        target = tmp_path / "burn.ass"
        burn_service.write_style_file(CUES, {"fontSize": 50}, target=target, width=640, height=360)
        body = target.read_text(encoding="utf-8")
        assert "[Script Info]" in body and "PlayResY: 360" in body
        assert body.count("Dialogue:") == 2


def _frame(video_path, at_seconds: float, target: Path) -> Path:
    subprocess.run(
        ["ffmpeg", "-y", "-loglevel", "error", "-ss", str(at_seconds), "-i", str(video_path),
         "-frames:v", "1", str(target)],
        check=True,
    )
    return target


def _max_difference(first: Path, second: Path) -> float:
    """Peak luma difference in the lower third, where captions live."""
    proc = subprocess.run(
        ["ffmpeg", "-v", "error", "-i", str(first), "-i", str(second), "-filter_complex",
         "blend=all_mode=difference,crop=iw:ih/3:0:ih*2/3,signalstats,metadata=print:key=lavfi.signalstats.YMAX:file=-",
         "-frames:v", "1", "-f", "null", "-"],
        capture_output=True, text=True,
    )
    for line in proc.stdout.splitlines():
        if "YMAX=" in line:
            return float(line.split("=")[-1])
    return 0.0
