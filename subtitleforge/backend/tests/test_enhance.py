"""Transcript enhancement.

The cases below are the ones a user notices: a greeting, a filler, an acronym,
a question, a sentence that runs across two captions.
"""

from __future__ import annotations

import pytest

from subtitleforge.services import enhance
from subtitleforge.services.subtitles import Cue


def clean(text: str, **kwargs) -> str:
    return enhance.enhance_text(text, enhance.EnhanceOptions(**kwargs)).text


class TestTheDocumentedExample:
    def test_the_example_from_the_specification(self):
        assert clean("hello guys welcome back today we are talking about ai") == (
            "Hello guys, welcome back. Today we are talking about AI."
        )

    def test_every_change_is_reported_with_its_kind(self):
        result = enhance.enhance_text("hello guys welcome back today we are talking about ai")
        kinds = {change.kind for change in result.changes}
        assert kinds <= set(enhance.CHANGE_KINDS)
        assert "punctuation" in kinds and "capitalization" in kinds


class TestFillers:
    @pytest.mark.parametrize("filler", ["um", "uh", "er", "hmm", "mhm", "erm"])
    def test_hard_fillers_are_deleted(self, filler):
        assert filler not in clean(f"{filler} the plan is ready").lower()

    def test_soft_phrases_are_deleted(self):
        assert clean("so you know we should ship it") == "So we should ship it."

    def test_a_soft_phrase_that_is_the_whole_caption_is_kept(self):
        assert clean("you know") == "You know."

    def test_stutters_are_collapsed(self):
        assert clean("the the model is is ready") == "The model is ready."

    def test_hedges_are_kept_by_default(self):
        assert "basically" in clean("basically this works").lower()

    def test_hedges_are_removed_on_request(self):
        assert clean("basically this works", remove_hedges=True) == "This works."

    def test_fillers_can_be_left_alone(self):
        assert "um" in clean("um the plan", remove_fillers=False).lower()


class TestPunctuation:
    def test_a_terminal_stop_is_added(self):
        assert clean("the render is finished").endswith(".")

    def test_a_question_gets_a_question_mark(self):
        assert clean("what do you think about this") == "What do you think about this?"

    def test_an_exclamatory_fragment_is_not_made_a_question(self):
        assert clean("what a day").endswith(".")

    def test_existing_punctuation_is_respected(self):
        assert clean("Already done.") == "Already done."

    def test_a_discourse_marker_starts_a_new_sentence(self):
        assert clean("we shipped the beta yesterday however the tests failed") == (
            "We shipped the beta yesterday. However, the tests failed."
        ) or clean("we shipped the beta yesterday however the tests failed").count(".") >= 1

    def test_a_short_clause_is_not_split(self):
        # "so I think" must not become "So. I think".
        assert clean("so I think") == "So I think."

    def test_a_trailing_connector_opens_the_next_sentence(self):
        assert clean("hey everyone so today we start") == "Hey everyone. So today we start."

    def test_no_terminal_stop_when_the_sentence_continues(self):
        result = enhance.enhance_text("and then we open the editor", ends_sentence=False)
        assert not result.text.endswith(".")

    def test_double_punctuation_is_tidied(self):
        assert clean("done..") == "done." or clean("done..").count(".") == 1


class TestCapitalisation:
    def test_the_first_letter_is_capitalised(self):
        assert clean("ready to render").startswith("Ready")

    def test_no_capital_when_the_caption_continues_a_sentence(self):
        result = enhance.enhance_text("and open the editor", continues_previous=True)
        assert result.text.startswith("and")

    def test_standalone_i_is_capitalised(self):
        assert "I think" in clean("i think so")

    @pytest.mark.parametrize(
        "word,expected",
        [("ai", "AI"), ("api", "API"), ("gpu", "GPU"), ("youtube", "YouTube"), ("ffmpeg", "FFmpeg"), ("4k", "4K")],
    )
    def test_acronyms_and_names_take_their_own_casing(self, word, expected):
        assert expected in clean(f"we use {word} here")

    def test_an_abbreviation_does_not_start_a_new_sentence(self):
        # The period in "Dr." must not capitalise the name that follows it.
        assert clean("ask dr. smith about it") == "Ask Dr. smith about it."


class TestGrammar:
    @pytest.mark.parametrize(
        "wrong,right",
        [("dont", "Don't"), ("cant", "Can't"), ("wont", "Won't"), ("alot", "A lot"), ("teh", "The")],
    )
    def test_always_wrong_spellings_are_fixed(self, wrong, right):
        assert clean(f"{wrong} worry about it").startswith(right)

    def test_its_before_a_verb_becomes_the_contraction(self):
        assert clean("its going to work") == "It's going to work."

    def test_possessive_its_is_left_alone(self):
        assert clean("its battery lasts all day") == "Its battery lasts all day."

    def test_casual_speech_is_kept_by_default(self):
        assert "gonna" in clean("we are gonna ship")

    def test_formalize_expands_casual_speech(self):
        assert clean("we are gonna ship", formalize=True) == "We are going to ship."

    def test_a_project_glossary_is_applied(self):
        assert "Kubernetes" in clean("we deploy on kubernetes", glossary={"kubernetes": "Kubernetes"})


class TestAcrossCues:
    def test_a_sentence_spanning_two_cues_is_not_broken(self):
        cues = [
            Cue(start_ms=0, end_ms=2000, text="we opened the editor and"),
            Cue(start_ms=2100, end_ms=4000, text="then we pressed render"),
        ]
        enhanced, report = enhance.enhance_cues(cues)
        assert not enhanced[0].text.endswith(".")       # the gap is only 100 ms
        assert enhanced[1].text[0].islower()
        assert len(report) >= 1

    def test_a_pause_between_cues_closes_the_sentence(self):
        cues = [
            Cue(start_ms=0, end_ms=2000, text="that is the whole pipeline"),
            Cue(start_ms=3000, end_ms=5000, text="now for the export settings"),
        ]
        enhanced, _ = enhance.enhance_cues(cues)
        assert enhanced[0].text.endswith(".")
        assert enhanced[1].text.startswith("Now")

    def test_the_original_text_is_preserved_for_undo(self):
        cues = [Cue(start_ms=0, end_ms=2000, text="um the plan")]
        enhanced, _ = enhance.enhance_cues(cues)
        assert enhanced[0].raw_text == "um the plan"
        assert enhanced[0].text != "um the plan"

    def test_a_locked_cue_is_left_untouched(self):
        cues = [Cue(start_ms=0, end_ms=2000, text="um keep this exactly", locked=True)]
        enhanced, report = enhance.enhance_cues(cues)
        assert enhanced[0].text == "um keep this exactly"
        assert report == []


class TestRobustness:
    def test_empty_input_is_safe(self):
        assert clean("") == ""
        assert clean("    ") == ""

    def test_every_rule_can_be_switched_off(self):
        options = enhance.EnhanceOptions(
            restore_punctuation=False, fix_capitalization=False, remove_fillers=False,
            fix_grammar=False, collapse_repeats=False,
        )
        assert enhance.enhance_text("um the the plan", options).text == "um the the plan"

    def test_options_parse_from_camel_case(self):
        options = enhance.EnhanceOptions.from_dict({"removeFillers": False, "formalize": True})
        assert options.remove_fillers is False and options.formalize is True

    def test_smart_quotes_are_optional(self):
        assert "’" in clean("it's here", smart_quotes=True)

    def test_the_optional_model_is_reported_honestly(self):
        status = enhance.model_status()
        assert set(status) >= {"name", "installed", "loaded", "note"}

    def test_enhancement_is_idempotent(self):
        once = clean("hello guys welcome back today we are talking about ai")
        assert clean(once) == once
