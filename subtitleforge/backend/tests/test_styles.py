"""Styling: the ASS translation and the shipped presets."""

from __future__ import annotations

import pytest

from subtitleforge.services import styles


class TestColours:
    def test_ass_colours_reverse_the_channels(self):
        # #FF0000 is red: in ASS that is &H000000FF (AABBGGRR, opaque).
        assert styles.to_ass_color("#FF0000") == "&H000000FF"
        assert styles.to_ass_color("#0000FF") == "&H00FF0000"
        assert styles.to_ass_color("#FFFFFF") == "&H00FFFFFF"

    def test_ass_alpha_is_inverted(self):
        assert styles.to_ass_color("#FFFFFF", 0.0).startswith("&HFF")
        assert styles.to_ass_color("#FFFFFF", 1.0).startswith("&H00")
        assert styles.to_ass_color("#FFFFFF", 0.5).startswith("&H80")

    def test_short_and_long_hex_both_parse(self):
        assert styles.parse_hex("#fff")[:3] == (255, 255, 255)
        # Eight digits are #RRGGBBAA, as in CSS: alpha last.
        assert styles.parse_hex("#FF000080")[:3] == (255, 0, 0)
        assert styles.parse_hex("#FF000080")[3] == pytest.approx(0.502, abs=0.01)

    def test_a_malformed_colour_falls_back_to_white(self):
        assert styles.parse_hex("not a colour")[:3] == (255, 255, 255)

    def test_css_colours_keep_the_channels_in_order(self):
        assert styles.to_css_color("#FF8000", 0.5) == "rgba(255, 128, 0, 0.5)"


class TestNormalisation:
    def test_defaults_fill_the_gaps(self):
        spec = styles.normalise_style({"fontSize": 60})
        assert spec["fontSize"] == 60
        assert spec["fontFamily"] == styles.DEFAULT_STYLE["fontFamily"]

    def test_named_alignments_become_numbers(self):
        assert styles.normalise_style({"alignment": "top-right"})["alignment"] == 9
        assert styles.normalise_style({"alignment": "bottom-center"})["alignment"] == 2

    def test_out_of_range_values_are_clamped(self):
        spec = styles.normalise_style({"fontSize": 9000, "outlineWidth": -4, "textOpacity": 5, "maxLines": 99})
        assert spec["fontSize"] == 400
        assert spec["outlineWidth"] == 0
        assert spec["textOpacity"] == 1.0
        assert spec["maxLines"] == 5

    def test_an_unknown_border_style_falls_back_to_outline(self):
        assert styles.normalise_style({"borderStyle": "glow"})["borderStyle"] == "outline"


class TestAssEmission:
    def test_sizes_scale_with_the_output_height(self):
        spec = {"fontSize": 54, "outlineWidth": 3, "marginVertical": 60}
        at_1080 = styles.ass_style_line("Default", spec, (1920, 1080))
        at_2160 = styles.ass_style_line("Default", spec, (3840, 2160))
        assert ",54," in at_1080
        assert ",108," in at_2160          # the same style, twice the pixels

    def test_bold_and_italic_use_the_ass_convention(self):
        line = styles.ass_style_line("Default", {"bold": True, "italic": False}, (1920, 1080))
        fields = line[len("Style: "):].split(",")
        assert fields[7] == "-1" and fields[8] == "0"

    def test_box_mode_switches_the_border_style_and_paints_the_box(self):
        line = styles.ass_style_line("Default", {"borderStyle": "box", "boxOpacity": 0.5}, (1920, 1080))
        fields = line[len("Style: "):].split(",")
        assert fields[15] == "3"            # BorderStyle 3 is the opaque box
        assert fields[6].startswith("&H80")  # half-transparent BackColour

    def test_the_header_declares_the_real_resolution(self):
        header = styles.ass_header_defaults(title="T", width=1080, height=1920, style={})
        assert "PlayResX: 1080" in header and "PlayResY: 1920" in header
        assert "ScaledBorderAndShadow: yes" in header

    def test_the_style_line_has_exactly_the_declared_field_count(self):
        from subtitleforge.services.subtitles import _ASS_STYLE_FORMAT

        expected = len(_ASS_STYLE_FORMAT[len("Format: "):].split(","))
        fields = styles.ass_style_line("Default", {}, (1920, 1080))[len("Style: "):].split(",")
        assert len(fields) == expected


class TestCss:
    def test_outline_becomes_a_text_shadow_ring(self):
        css = styles.to_css({"outlineWidth": 2}, 1080)
        assert css["textShadow"].count("rgba") >= 8

    def test_box_mode_sets_a_background(self):
        css = styles.to_css({"borderStyle": "box", "boxOpacity": 0.8}, 1080)
        assert css["backgroundColor"].startswith("rgba")

    def test_alignment_maps_to_flexbox(self):
        assert styles.to_css({"alignment": 8}, 1080)["justifyContent"] == "flex-start"
        assert styles.to_css({"alignment": 2}, 1080)["justifyContent"] == "flex-end"
        assert styles.to_css({"alignment": 5}, 1080)["justifyContent"] == "center"

    def test_uppercase_is_a_css_transform_not_a_text_edit(self):
        assert styles.to_css({"uppercase": True}, 1080)["textTransform"] == "uppercase"


class TestPresets:
    def test_all_five_presets_ship(self):
        assert [preset["name"] for preset in styles.STYLE_PRESETS] == [
            "Netflix", "YouTube", "TikTok", "Documentary", "Minimalist",
        ]

    @pytest.mark.parametrize("preset", styles.STYLE_PRESETS, ids=lambda p: p["name"])
    def test_every_preset_is_valid_and_describes_itself(self, preset):
        spec = styles.normalise_style(preset)
        assert spec["fontSize"] > 0
        assert 1 <= spec["alignment"] <= 9
        assert preset["description"]
        assert styles.ass_style_line(preset["name"], spec, (1920, 1080)).startswith("Style: ")

    def test_youtube_uses_a_box_and_netflix_does_not(self):
        assert styles.PRESETS_BY_NAME["YouTube"]["borderStyle"] == "box"
        assert styles.PRESETS_BY_NAME["Netflix"]["borderStyle"] == "outline"

    def test_tiktok_is_short_lined_and_centred_high(self):
        tiktok = styles.PRESETS_BY_NAME["TikTok"]
        assert tiktok["maxCharsPerLine"] <= 24
        assert tiktok["alignment"] == 5
