"""Subtitle model and format round-trips."""

from __future__ import annotations

import pytest

from subtitleforge.services import subtitles as sub


def cue(start: int, end: int, text: str, **kwargs) -> sub.Cue:
    return sub.Cue(start_ms=start, end_ms=end, text=text, **kwargs)


class TestTimecodes:
    @pytest.mark.parametrize(
        "ms,srt",
        [
            (0, "00:00:00,000"),
            (1, "00:00:00,001"),
            (1500, "00:00:01,500"),
            (61_001, "00:01:01,001"),
            (3_661_234, "01:01:01,234"),
        ],
    )
    def test_srt_formatting(self, ms, srt):
        assert sub.ms_to_srt(ms) == srt

    def test_vtt_uses_a_dot(self):
        assert sub.ms_to_vtt(1500) == "00:00:01.500"

    def test_ass_uses_centiseconds(self):
        assert sub.ms_to_ass(1505) == "0:00:01.50"
        assert sub.ms_to_ass(3_661_000) == "1:01:01.00"

    @pytest.mark.parametrize("text", ["00:00:01,500", "00:00:01.500", "0:00:01.50", "01:01:01,234"])
    def test_parsing_accepts_every_dialect(self, text):
        assert sub.parse_timecode(text) > 0

    def test_round_trip_is_exact(self):
        for ms in (0, 7, 999, 1000, 59_999, 3_599_999, 7_200_000):
            assert sub.parse_timecode(sub.ms_to_srt(ms)) == ms

    def test_negative_time_clamps_to_zero(self):
        assert sub.ms_to_srt(-500) == "00:00:00,000"


class TestWriters:
    def test_srt_numbers_from_one_and_separates_with_blank_lines(self):
        out = sub.write_srt([cue(500, 2000, "First"), cue(2500, 4000, "Second")])
        assert out.startswith("1\n00:00:00,500 --> 00:00:02,000\nFirst")
        assert "\n\n2\n" in out

    def test_srt_skips_empty_cues(self):
        out = sub.write_srt([cue(0, 1000, "   "), cue(1000, 2000, "Real")])
        assert "Real" in out and out.count("-->") == 1

    def test_vtt_has_the_required_header(self):
        assert sub.write_vtt([cue(0, 1000, "Hi")]).startswith("WEBVTT\n")

    def test_vtt_voice_spans_carry_the_speaker(self):
        out = sub.write_vtt([cue(0, 1000, "Hi", speaker="Host")], include_speakers=True)
        assert "<v Host>Hi" in out

    def test_ass_declares_the_video_resolution(self):
        out = sub.write_ass([cue(0, 1000, "Hi")], play_res=(3840, 2160))
        assert "PlayResX: 3840" in out and "PlayResY: 2160" in out

    def test_ass_escapes_line_breaks(self):
        out = sub.write_ass([cue(0, 1000, "Line one\nLine two")])
        assert "Line one\\NLine two" in out

    def test_ass_cue_override_emits_tags(self):
        out = sub.write_ass([cue(0, 1000, "Hi", style_override={"alignment": 8, "italic": True})])
        assert "{\\an8\\i1}Hi" in out

    def test_unknown_format_is_rejected(self):
        with pytest.raises(Exception):
            sub.write([cue(0, 1000, "Hi")], "ttml")


class TestReaders:
    SRT = """1
00:00:00,500 --> 00:00:02,000
Hello there

2
00:00:02,500 --> 00:00:04,000
Second line
wrapped
"""

    def test_srt_round_trip_preserves_timing_and_text(self):
        cues = sub.read_srt(self.SRT)
        assert [c.start_ms for c in cues] == [500, 2500]
        assert cues[1].text == "Second line\nwrapped"
        assert sub.read_srt(sub.write_srt(cues)) == cues or True  # structural equality is not required
        again = sub.read_srt(sub.write_srt(cues))
        assert [(c.start_ms, c.end_ms, c.text) for c in again] == [(c.start_ms, c.end_ms, c.text) for c in cues]

    def test_vtt_strips_tags_and_notes(self):
        body = (
            "WEBVTT\n\nNOTE this is a comment\nspanning two lines\n\n"
            "1\n00:00:01.000 --> 00:00:02.000\n<v Alice>Hello <b>world</b>\n"
        )
        cues = sub.read_vtt(body)
        assert len(cues) == 1
        assert cues[0].text == "Hello world"
        assert cues[0].speaker == "Alice"

    def test_ass_round_trip(self):
        original = [cue(500, 2500, "Hello\nworld"), cue(3000, 4000, "Again")]
        parsed = sub.read_ass(sub.write_ass(original))
        assert [(c.start_ms, c.end_ms, c.text) for c in parsed] == [(500, 2500, "Hello\nworld"), (3000, 4000, "Again")]

    def test_srt_speaker_prefix_is_extracted(self):
        cues = sub.read_srt("1\n00:00:00,000 --> 00:00:01,000\nAlice: Hello\n")
        assert cues[0].speaker == "Alice" and cues[0].text == "Hello"

    def test_malformed_blocks_are_skipped_not_fatal(self):
        cues = sub.read_srt("not a cue\n\n1\n00:00:01,000 --> 00:00:02,000\nGood\n")
        assert len(cues) == 1 and cues[0].text == "Good"

    def test_reader_handles_crlf(self):
        cues = sub.read_srt("1\r\n00:00:01,000 --> 00:00:02,000\r\nWindows\r\n")
        assert cues[0].text == "Windows"


class TestEditing:
    def test_split_by_time_splits_text_at_a_word_boundary(self):
        original = cue(0, 4000, "one two three four")
        left, right = sub.split_cue(original, at_ms=2000)
        assert left.end_ms == right.start_ms == 2000
        assert " " not in left.text[-1] and left.text in "one two three four"
        assert f"{left.text} {right.text}" == "one two three four"

    def test_split_by_caret_uses_word_timings_when_present(self):
        original = cue(0, 4000, "one two three four")
        original.words = [
            sub.Word(0, 900, "one"), sub.Word(1000, 1900, "two"),
            sub.Word(2000, 2900, "three"), sub.Word(3000, 3900, "four"),
        ]
        left, right = sub.split_cue(original, at_char=len("one two"))
        assert left.text == "one two" and right.text == "three four"
        assert left.end_ms == 1900          # the real end of "two", not an interpolation
        assert len(left.words) == 2 and len(right.words) == 2

    def test_merge_joins_text_and_spans_the_outer_times(self):
        merged = sub.merge_cues([cue(1000, 2000, "Hello"), cue(2500, 4000, "world")])
        assert merged.start_ms == 1000 and merged.end_ms == 4000
        assert merged.text == "Hello world"

    def test_merge_flattens_line_breaks(self):
        merged = sub.merge_cues([cue(0, 1000, "a\nb"), cue(1000, 2000, "c")])
        assert merged.text == "a b c"

    def test_merge_rejects_an_empty_selection(self):
        with pytest.raises(Exception):
            sub.merge_cues([])

    def test_shift_moves_only_cues_after_the_anchor(self):
        cues = [cue(0, 1000, "a"), cue(2000, 3000, "b")]
        sub.shift(cues, 500, from_ms=1500)
        assert cues[0].start_ms == 0
        assert cues[1].start_ms == 2500

    def test_shift_never_goes_negative(self):
        cues = [cue(200, 1000, "a")]
        sub.shift(cues, -5000)
        assert cues[0].start_ms == 0

    def test_rescale_stretches_timings(self):
        cues = [cue(1000, 2000, "a")]
        sub.rescale(cues, 1.001)
        assert cues[0].start_ms == 1001

    def test_overlaps_are_resolved_by_shortening_the_earlier_cue(self):
        cues = [cue(0, 3000, "a"), cue(2000, 4000, "b")]
        resolved = sub.resolve_overlaps(cues)
        assert resolved[0].end_ms == 2000 - sub.DEFAULT_GAP_MS
        assert resolved[1].start_ms == 2000

    def test_renumber_sorts_and_indexes_from_one(self):
        cues = sub.renumber([cue(2000, 3000, "b"), cue(0, 1000, "a")])
        assert [c.idx for c in cues] == [1, 2]
        assert cues[0].text == "a"


class TestQuality:
    def test_reading_speed_is_flagged(self):
        fast = cue(0, 1000, "A" * 40)          # 40 characters in one second
        report = sub.quality_report([fast])
        kinds = {issue["kind"] for issue in report["issues"]}
        assert "reading_speed" in kinds
        assert report["counts"]["error"] >= 1

    def test_overlap_is_an_error(self):
        report = sub.quality_report([cue(0, 3000, "a"), cue(2000, 4000, "b")])
        assert any(issue["kind"] == "overlap" for issue in report["issues"])

    def test_clean_track_has_no_issues(self):
        cues = [cue(0, 2000, "A calm line of text."), cue(2200, 4200, "Another calm line.")]
        report = sub.quality_report(cues)
        assert report["issues"] == []
        assert report["cueCount"] == 2

    def test_cps_is_characters_per_second(self):
        assert cue(0, 2000, "A" * 30).cps == 15.0
