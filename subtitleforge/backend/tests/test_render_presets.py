"""Output presets and the FFmpeg argument builder."""

from __future__ import annotations

import pytest

from subtitleforge.services import burn, ffmpeg, render_presets


class TestPresets:
    def test_five_presets_ship_and_each_explains_itself(self):
        assert len(render_presets.RENDER_PRESETS) == 5
        assert all(preset["description"] for preset in render_presets.RENDER_PRESETS)

    def test_a_named_preset_fills_the_options(self):
        options = render_presets.resolve({"presetName": "Master 4K"})
        assert options["crf"] == 17 and options["maxHeight"] == 2160

    def test_explicit_options_beat_the_preset(self):
        options = render_presets.resolve({"presetName": "Draft", "crf": 12})
        assert options["crf"] == 12

    def test_values_are_clamped_to_legal_ranges(self):
        assert render_presets.resolve({"crf": 900})["crf"] == 51
        assert render_presets.resolve({"bitrateKbps": 1})["bitrateKbps"] == 200

    def test_an_unknown_audio_mode_falls_back_to_copy(self):
        assert render_presets.resolve({"audio": "opus"})["audio"] == "copy"


class TestEncoderArguments:
    def test_x264_takes_crf_and_a_preset(self):
        args = burn._encoder_args("libx264", render_presets.resolve({"crf": 20, "preset": "slow"}))
        assert "-crf" in args and args[args.index("-crf") + 1] == "20"
        assert args[args.index("-preset") + 1] == "slow"

    def test_nvenc_takes_cq_not_crf(self):
        args = burn._encoder_args("h264_nvenc", render_presets.resolve({"crf": 20}))
        assert "-cq" in args and "-crf" not in args
        assert args[args.index("-rc") + 1] == "vbr"

    def test_quick_sync_takes_global_quality(self):
        args = burn._encoder_args("h264_qsv", render_presets.resolve({"crf": 22}))
        assert "-global_quality" in args

    def test_amf_maps_the_preset_to_a_quality_name(self):
        args = burn._encoder_args("h264_amf", render_presets.resolve({"preset": "slow"}))
        assert args[args.index("-quality") + 1] == "quality"

    def test_every_encoder_sets_a_pixel_format_browsers_can_play(self):
        for encoder in ("libx264", "h264_nvenc", "h264_amf", "h264_videotoolbox"):
            args = burn._encoder_args(encoder, render_presets.resolve({}))
            assert "-pix_fmt" in args


class TestOutputSizing:
    def test_a_height_cap_scales_to_even_dimensions(self):
        assert burn._output_size(3840, 2160, {"maxHeight": 1080}) == (1920, 1080)

    def test_odd_sources_round_to_even(self):
        width, height = burn._output_size(1919, 1081, {"maxHeight": 720})
        assert width % 2 == 0 and height % 2 == 0

    def test_a_smaller_source_is_not_upscaled(self):
        assert burn._output_size(1280, 720, {"maxHeight": 1080}) == (1280, 720)

    def test_vertical_output_is_nine_by_sixteen(self):
        assert burn._output_size(1920, 1080, {"aspect": "9:16", "maxHeight": 1920}) == (1080, 1920)

    def test_square_output(self):
        assert burn._output_size(1920, 1080, {"aspect": "1:1", "maxHeight": 1080}) == (1080, 1080)


class TestFilterEscaping:
    def test_a_windows_path_is_escaped_for_the_filtergraph(self):
        escaped = ffmpeg.escape_filter_path(r"C:\Users\Sam\My Video\captions.ass")
        assert escaped == r"C\:/Users/Sam/My Video/captions.ass"

    def test_brackets_and_commas_are_escaped(self):
        assert ffmpeg.escape_filter_path("/tmp/a[1],b.ass") == r"/tmp/a\[1\]\,b.ass"

    def test_an_apostrophe_is_escaped(self):
        assert ffmpeg.escape_filter_path("/tmp/sam's.ass") == r"/tmp/sam\'s.ass"


class TestOutputNaming:
    def test_the_default_name_adds_the_suffix(self, tmp_path):
        source = tmp_path / "holiday.mov"
        source.write_bytes(b"")
        assert burn.default_output_path(source).name == "holiday_subtitled.mp4"

    def test_an_existing_output_is_never_overwritten(self, tmp_path):
        source = tmp_path / "clip.mp4"
        source.write_bytes(b"")
        (tmp_path / "clip_subtitled.mp4").write_bytes(b"")
        assert burn.default_output_path(source).name == "clip_subtitled_2.mp4"

    def test_the_software_retry_turns_hardware_off(self):
        assert burn.retry_without_hardware({"allowHardware": True, "encoder": "h264_nvenc"}) == {
            "allowHardware": False, "encoder": "auto",
        }


class TestEstimates:
    def test_hardware_is_estimated_faster_than_software(self):
        from subtitleforge.services.media import estimate_render_seconds

        hardware = estimate_render_seconds(600_000, 1920, True)
        software = estimate_render_seconds(600_000, 1920, False)
        assert hardware is not None and software is not None and hardware < software

    def test_4k_is_estimated_slower_than_1080p(self):
        from subtitleforge.services.media import estimate_render_seconds

        assert estimate_render_seconds(600_000, 3840, False) > estimate_render_seconds(600_000, 1920, False)

    def test_unknown_duration_gives_no_estimate(self):
        from subtitleforge.services.media import estimate_render_seconds

        assert estimate_render_seconds(None, 1920, False) is None
