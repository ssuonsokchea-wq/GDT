"""Segmentation: the quality-critical path from words to captions."""

from __future__ import annotations

import pytest

from subtitleforge.services import segmentation as seg
from subtitleforge.services.subtitles import Word


def words(spec: list[tuple[int, int, str]]) -> list[Word]:
    return [Word(start_ms=start, end_ms=end, text=text) for start, end, text in spec]


def even_words(text: str, *, start: int = 0, each_ms: int = 300) -> list[Word]:
    out = []
    cursor = start
    for token in text.split():
        out.append(Word(start_ms=cursor, end_ms=cursor + each_ms - 20, text=token))
        cursor += each_ms
    return out


class TestWrapping:
    def test_short_text_is_left_on_one_line(self):
        assert seg.wrap_lines("Hello there", 42, 2) == "Hello there"

    def test_two_lines_are_balanced_not_greedy(self):
        text = "The quick brown fox jumps over the lazy dog today"
        wrapped = seg.wrap_lines(text, 30, 2)
        lines = wrapped.split("\n")
        assert len(lines) == 2
        assert all(len(line) <= 30 for line in lines)
        # Greedy wrapping would produce a 29/19 split; balance beats it.
        assert abs(len(lines[0]) - len(lines[1])) <= 8

    def test_a_line_does_not_end_on_an_article(self):
        wrapped = seg.wrap_lines("I want to show you the best way to do this", 24, 2)
        first = wrapped.split("\n")[0]
        assert not first.rstrip().endswith(("the", "a", "an", "to"))

    def test_break_prefers_a_comma_over_a_tighter_balance(self):
        # Splitting after "that" would balance the lines better, but breaking
        # on the comma reads correctly, so the comma wins.
        wrapped = seg.wrap_lines("Yes I agree, that is the plan", 18, 2)
        assert wrapped == "Yes I agree,\nthat is the plan"

    def test_single_line_limit_never_wraps(self):
        text = "A very long caption that will not fit in twenty characters at all"
        assert "\n" not in seg.wrap_lines(text, 20, 1)

    def test_words_are_never_broken(self):
        wrapped = seg.wrap_lines("extraordinarily complicated terminology", 10, 3)
        for line in wrapped.split("\n"):
            assert " " in line or line in "extraordinarily complicated terminology".split()

    def test_empty_input_is_empty_output(self):
        assert seg.wrap_lines("   ", 42, 2) == ""


class TestSegmentWords:
    def test_character_limit_forces_a_break(self):
        options = seg.SegmentOptions(max_chars_per_line=20, max_lines=1, pause_break_ms=10_000)
        cues = seg.segment_words(even_words("one two three four five six seven eight nine ten"), options)
        assert len(cues) > 1
        assert all(len(cue.text.replace("\n", " ")) <= 20 for cue in cues)

    def test_a_long_pause_always_breaks(self):
        spec = [(0, 400, "before"), (0 + 2000, 2400, "after")]
        cues = seg.segment_words(words(spec), seg.SegmentOptions())
        assert len(cues) == 2

    def test_a_short_gap_does_not_break(self):
        spec = [(0, 400, "before"), (450, 850, "after")]
        cues = seg.segment_words(words(spec), seg.SegmentOptions(max_chars_per_line=60))
        assert len(cues) == 1

    def test_sentence_end_breaks_when_the_cue_can_stand_alone(self):
        cues = seg.segment_words(
            even_words("this is the first sentence. and this is the second one"), seg.SegmentOptions()
        )
        assert len(cues) >= 2
        assert cues[0].text.rstrip().endswith(".")

    def test_speaker_change_breaks_mid_sentence(self):
        tokens = even_words("hello how are you doing today")
        speakers = ["A", "A", "A", "B", "B", "B"]
        cues = seg.segment_words(tokens, seg.SegmentOptions(max_chars_per_line=80), speakers)
        assert [cue.speaker for cue in cues] == ["A", "B"]

    def test_timings_come_from_the_words(self):
        cues = seg.segment_words(words([(500, 900, "hi"), (1000, 1500, "there")]), seg.SegmentOptions())
        assert cues[0].start_ms == 500 and cues[0].end_ms == 1500

    def test_word_timings_are_carried_into_the_cue(self):
        cues = seg.segment_words(even_words("one two three"), seg.SegmentOptions())
        assert sum(len(cue.words) for cue in cues) == 3

    def test_confidence_is_averaged(self):
        tokens = [Word(0, 500, "a", 0.9), Word(500, 1000, "b", 0.5)]
        cues = seg.segment_words(tokens, seg.SegmentOptions())
        assert cues[0].confidence == pytest.approx(0.7, abs=0.001)

    def test_no_words_gives_no_cues(self):
        assert seg.segment_words([], seg.SegmentOptions()) == []

    def test_blank_tokens_are_ignored(self):
        cues = seg.segment_words(words([(0, 100, "   "), (200, 600, "real")]), seg.SegmentOptions())
        assert len(cues) == 1 and cues[0].text == "real"


class TestPolish:
    def test_a_flash_cue_is_extended_to_the_minimum(self):
        cues = seg.segment_words(words([(0, 200, "hi")]), seg.SegmentOptions())
        assert cues[0].duration_ms >= seg.MIN_CUE_MS

    def test_extension_never_runs_into_the_next_cue(self):
        options = seg.SegmentOptions()
        cues = seg.segment_words(words([(0, 200, "hi"), (1200, 2000, "there")]), options)
        assert cues[0].end_ms <= cues[1].start_ms - options.gap_ms

    def test_fast_reading_borrows_from_following_silence(self):
        options = seg.SegmentOptions(max_cps=10.0, target_cps=8.0)
        dense = [Word(0, 800, "extraordinarily"), Word(800, 1000, "complicated")]
        cues = seg.polish(seg.segment_words(dense, options), options)
        assert cues[0].cps <= 12.0

    def test_cues_never_overlap_after_polish(self):
        cues = seg.polish(
            [
                seg.Cue(start_ms=0, end_ms=3000, text="a"),
                seg.Cue(start_ms=2000, end_ms=4000, text="b"),
            ],
            seg.SegmentOptions(),
        )
        assert cues[0].end_ms <= cues[1].start_ms


class TestResegment:
    def test_resegment_reuses_word_timings(self):
        original = seg.segment_words(even_words("one two three four five six"), seg.SegmentOptions(max_chars_per_line=60))
        tighter = seg.resegment(original, seg.SegmentOptions(max_chars_per_line=12, max_lines=1))
        assert len(tighter) > len(original)
        assert all(len(cue.text) <= 12 for cue in tighter)

    def test_resegment_without_word_timings_still_works(self):
        plain = [seg.Cue(start_ms=0, end_ms=4000, text="one two three four five six seven eight")]
        out = seg.resegment(plain, seg.SegmentOptions(max_chars_per_line=14, max_lines=1))
        assert len(out) > 1
        assert out[0].start_ms == 0


class TestSegmentFromSegments:
    def test_segment_level_input_interpolates_word_times(self):
        cues = seg.segment_segments(
            [{"startMs": 0, "endMs": 4000, "text": "one two three four", "speaker": None}],
            seg.SegmentOptions(max_chars_per_line=10, max_lines=1),
        )
        assert len(cues) >= 2
        assert cues[0].start_ms == 0
        assert cues[-1].end_ms <= 4000

    def test_options_from_camel_case_payload(self):
        options = seg.SegmentOptions.from_dict({"maxCharsPerLine": 30, "maxLines": 3, "targetCps": 12})
        assert (options.max_chars_per_line, options.max_lines, options.target_cps) == (30, 3, 12)
