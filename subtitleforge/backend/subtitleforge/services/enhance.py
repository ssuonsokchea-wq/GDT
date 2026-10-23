"""Transcript enhancement: punctuation, capitalisation, fillers, readability.

Speech recognition gives you words. A caption needs sentences. Whisper's
English models already punctuate reasonably, so this stage is mostly repair
work on top: restoring the stops it missed, deleting the "um"s it faithfully
transcribed, capitalising what it lower-cased, and fixing the handful of
spellings that are wrong in every context.

Two layers, in order:

1. **A deterministic rule engine** (this module). It is fast, auditable and
   reversible — every change is reported with its kind, so the editor can show
   them and the user can reject any of them. Nothing here guesses.
2. **An optional local punctuation model**, used only when the user has
   installed one (``deepmultilingualpunctuation``) and its weights sit in the
   app's models directory. It restores commas and stops in long unpunctuated
   passages better than rules can, and it still runs entirely offline.

Both layers are deliberately conservative. A caption that reads slightly flat
is a smaller failure than one that changes what the speaker said.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Any, Sequence

from .lexicon import (
    ACRONYMS,
    CASUAL_KEEP,
    GRAMMAR_FIXES,
    GREETINGS,
    HARD_FILLERS,
    HEDGE_WORDS,
    PROPER_NOUNS,
    QUESTION_OPENERS,
    SENTENCE_STARTERS,
    SOFT_FILLER_PHRASES,
    VOCATIVES,
)
from .subtitles import Cue

CHANGE_KINDS = ("filler", "punctuation", "capitalization", "grammar", "readability", "model")


@dataclass(slots=True)
class EnhanceOptions:
    restore_punctuation: bool = True
    fix_capitalization: bool = True
    remove_fillers: bool = True
    remove_hedges: bool = False
    fix_grammar: bool = True
    formalize: bool = False            # expand "gonna" to "going to"
    collapse_repeats: bool = True
    smart_quotes: bool = False
    use_model: bool = False            # optional local punctuation model
    glossary: dict[str, str] = field(default_factory=dict)

    @classmethod
    def from_dict(cls, data: dict | None) -> "EnhanceOptions":
        data = data or {}
        mapping = {
            "restorePunctuation": "restore_punctuation",
            "fixCapitalization": "fix_capitalization",
            "removeFillers": "remove_fillers",
            "removeHedges": "remove_hedges",
            "fixGrammar": "fix_grammar",
            "formalize": "formalize",
            "collapseRepeats": "collapse_repeats",
            "smartQuotes": "smart_quotes",
            "useModel": "use_model",
            "glossary": "glossary",
        }
        kwargs: dict[str, Any] = {}
        for camel, snake in mapping.items():
            if data.get(camel) is not None:
                kwargs[snake] = data[camel]
            elif data.get(snake) is not None:
                kwargs[snake] = data[snake]
        return cls(**kwargs)


@dataclass(slots=True)
class Change:
    kind: str
    before: str
    after: str
    note: str = ""

    def to_dict(self) -> dict:
        return {"kind": self.kind, "before": self.before, "after": self.after, "note": self.note}


@dataclass(slots=True)
class EnhanceResult:
    text: str
    changes: list[Change] = field(default_factory=list)

    def to_dict(self) -> dict:
        return {"text": self.text, "changes": [c.to_dict() for c in self.changes]}


# --------------------------------------------------------------------------
# Entry points
# --------------------------------------------------------------------------


def enhance_text(
    text: str,
    options: EnhanceOptions | None = None,
    *,
    continues_previous: bool = False,
    ends_sentence: bool = True,
) -> EnhanceResult:
    """Clean one caption.

    ``continues_previous`` suppresses the leading capital when the cue picks up
    mid-sentence; ``ends_sentence`` suppresses the trailing full stop when the
    sentence runs on into the next cue. Both come from the timing gaps between
    cues, which is why :func:`enhance_cues` gives better results than calling
    this on isolated strings.
    """
    opts = options or EnhanceOptions()
    changes: list[Change] = []
    working = _normalise_whitespace(text)
    if not working.strip():
        return EnhanceResult(text="", changes=[])

    original = working

    if opts.remove_fillers:
        working = _strip_fillers(working, opts, changes)
    if opts.collapse_repeats:
        working = _collapse_repeats(working, changes)
    if opts.fix_grammar:
        working = _fix_words(working, opts, changes)
    if opts.use_model:
        working = _model_punctuate(working, changes)
    if opts.restore_punctuation:
        working = _restore_punctuation(working, changes, ends_sentence=ends_sentence)
    if opts.fix_capitalization:
        working = _fix_capitalisation(working, opts, changes, continues_previous=continues_previous)
    working = _apply_glossary(working, opts, changes)
    if opts.smart_quotes:
        working = _smart_quotes(working, changes)
    working = _tidy_punctuation(working)

    if working != original and not changes:
        changes.append(Change("readability", original, working, "whitespace and punctuation tidied"))
    return EnhanceResult(text=working.strip(), changes=changes)


def enhance_cues(
    cues: Sequence[Cue], options: EnhanceOptions | None = None, *, sentence_gap_ms: int = 450
) -> tuple[list[Cue], list[dict]]:
    """Enhance a whole track, using the gaps between cues as sentence evidence.

    A pause of about half a second between cues almost always means the
    sentence ended; a shorter gap usually means it did not. Using that, the
    enhancer stops planting full stops mid-clause — the single most common
    artefact of per-line cleanup.
    """
    opts = options or EnhanceOptions()
    ordered = sorted(cues, key=lambda cue: cue.start_ms)
    report: list[dict] = []
    for position, cue in enumerate(ordered):
        if cue.locked:
            continue
        gap_before = cue.start_ms - ordered[position - 1].end_ms if position > 0 else None
        gap_after = ordered[position + 1].start_ms - cue.end_ms if position + 1 < len(ordered) else None
        previous_text = ordered[position - 1].text if position > 0 else ""
        continues = bool(
            position > 0
            and gap_before is not None
            and gap_before < sentence_gap_ms
            and not re.search(r"[.!?]['\")\]]?\s*$", previous_text.strip())
        )
        ends = gap_after is None or gap_after >= sentence_gap_ms
        result = enhance_text(cue.text, opts, continues_previous=continues, ends_sentence=ends)
        if result.text != cue.text:
            if cue.raw_text is None:
                cue.raw_text = cue.text
            report.append({"cueIdx": cue.idx, "before": cue.text, "after": result.text,
                           "changes": [c.to_dict() for c in result.changes]})
            cue.text = result.text
    return ordered, report


# --------------------------------------------------------------------------
# Rule layers
# --------------------------------------------------------------------------


def _normalise_whitespace(text: str) -> str:
    text = text.replace(" ", " ")
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r" *\n *", "\n", text)
    return text.strip()


def _strip_fillers(text: str, opts: EnhanceOptions, changes: list[Change]) -> str:
    before = text

    def drop_hard(match: re.Match) -> str:
        return ""

    pattern = r"\b(" + "|".join(sorted((re.escape(f) for f in HARD_FILLERS), key=len, reverse=True)) + r")\b[,.]?"
    text = re.sub(pattern, drop_hard, text, flags=re.IGNORECASE)

    for phrase in SOFT_FILLER_PHRASES:
        # Keep the phrase when it is the entire caption: "You know." is an answer.
        if text.strip().lower().rstrip(".!?") == phrase:
            continue
        text = re.sub(rf"(?:^|(?<=[\s,]))\b{re.escape(phrase)}\b[,]?", "", text, flags=re.IGNORECASE)

    if opts.remove_hedges:
        hedge_pattern = r"\b(" + "|".join(sorted(HEDGE_WORDS, key=len, reverse=True)) + r")\b[,]?"
        text = re.sub(hedge_pattern, "", text, flags=re.IGNORECASE)

    text = _normalise_whitespace(re.sub(r"\s{2,}", " ", text))
    text = re.sub(r"^[,;:.\s]+", "", text)
    if text != before:
        changes.append(Change("filler", before, text, "filler words removed"))
    return text


def _collapse_repeats(text: str, changes: list[Change]) -> str:
    """Delete stutters: "the the model", "I I think"."""
    before = text
    text = re.sub(r"\b(\w+)(\s+\1\b)+", r"\1", text, flags=re.IGNORECASE)
    if text != before:
        changes.append(Change("readability", before, text, "repeated word collapsed"))
    return text


def _fix_words(text: str, opts: EnhanceOptions, changes: list[Change]) -> str:
    before = text
    fixes = dict(GRAMMAR_FIXES)
    if not opts.formalize:
        for word in CASUAL_KEEP:
            fixes.pop(word, None)

    def replace(match: re.Match) -> str:
        word = match.group(0)
        replacement = fixes.get(word.lower())
        if replacement is None:
            return word
        if word[0].isupper():
            replacement = replacement[0].upper() + replacement[1:]
        return replacement

    text = re.sub(r"\b[A-Za-z']+\b", replace, text)
    # "i" standing alone is always "I".
    text = re.sub(r"\bi\b", "I", text)
    # Possessive "its" is always followed by a noun phrase, so "its" before any
    # of these is the contraction. Narrow enough to apply without a parser.
    text = re.sub(
        r"\b([Ii])ts\b(?=\s+(?:a|an|the|not|just|really|gonna|going|been|too|very|so|still|"
        r"already|probably|definitely|about|because|like|always|never|only|all)\b)",
        r"\1t's",
        text,
    )
    if text != before:
        changes.append(Change("grammar", before, text, "spelling and contractions corrected"))
    return text


_SENTENCE_STARTER_RE = re.compile(
    r"(?<=[a-z0-9])\s+(" + "|".join(sorted((re.escape(s) for s in SENTENCE_STARTERS), key=len, reverse=True)) + r")\b",
    flags=re.IGNORECASE,
)


def _restore_punctuation(text: str, changes: list[Change], *, ends_sentence: bool = True) -> str:
    """Insert the stops speech leaves out.

    Three signals carry almost all of it: a greeting takes a comma before the
    rest of the clause, a discourse marker ("so", "today", "but") in mid-caption
    starts a new sentence, and a caption that ends a sentence needs a terminal
    mark whose shape depends on whether the clause was a question.
    """
    before = text
    if "\n" in text:
        # Line breaks are layout, not grammar. Work on the flat string and let
        # the segmenter re-wrap afterwards.
        text = text.replace("\n", " ")

    text = _comma_after_greeting(text)

    def split_marker(match: re.Match) -> str:
        marker = match.group(1)
        return f". {marker[0].upper()}{marker[1:]}"

    # Only break where the preceding clause is long enough to stand alone;
    # "so I think" must not become "So. I think".
    pieces = []
    cursor = 0
    for match in _SENTENCE_STARTER_RE.finditer(text):
        head = text[cursor : match.start()]
        if len(head.split()) >= 3 and not re.search(r"[,;:]\s*$", head):
            head, carried = _carry_connector(head)
            if len(head.split()) < 2:
                continue
            pieces.append(head)
            marker = match.group(1)
            if carried:
                # "hey everyone so today ..." becomes "Hey everyone. So today ..."
                # rather than losing the connector or stranding it as a sentence.
                pieces.append(f". {carried[0].upper()}{carried[1:]} {marker}")
            else:
                pieces.append(split_marker(match))
            cursor = match.end()
    pieces.append(text[cursor:])
    text = "".join(pieces)
    text = re.sub(r"\.\s*\.", ".", text)
    text = re.sub(r"\.\s+", ". ", text)

    if ends_sentence:
        stripped = text.rstrip()
        if stripped and stripped[-1] not in ".!?,:;—-":
            stripped += "?" if _looks_like_question(stripped) else "."
        text = stripped
    if text != before:
        changes.append(Change("punctuation", before, text, "sentence punctuation restored"))
    return text


_CONNECTORS = {"so", "but", "and", "then", "now", "also", "plus", "well", "okay", "ok", "alright", "or"}


def _carry_connector(head: str) -> tuple[str, str | None]:
    """Detach a trailing connector so it opens the next sentence instead."""
    words = head.split()
    if len(words) >= 3 and words[-1].strip(",").lower() in _CONNECTORS:
        return " ".join(words[:-1]), words[-1].strip(",").lower()
    return head, None


def _comma_after_greeting(text: str) -> str:
    words = text.split()
    if not words:
        return text
    lowered = [word.strip(".,!?").lower() for word in words]
    greeting_len = 0
    for length in (2, 1):
        if len(lowered) >= length and " ".join(lowered[:length]) in GREETINGS:
            greeting_len = length
            break
    if not greeting_len:
        return text
    cursor = greeting_len
    # Absorb a vocative: "hello guys", "hey everyone", "hi my friends".
    for length in (2, 1):
        if len(lowered) >= cursor + length and " ".join(lowered[cursor : cursor + length]) in VOCATIVES:
            cursor += length
            break
    if cursor >= len(words):
        return text
    head = " ".join(words[:cursor])
    if head.endswith((",", ".", "!", "?")):
        return text
    return f"{head}, " + " ".join(words[cursor:])


def _looks_like_question(text: str) -> bool:
    clause = re.split(r"[.!?]", text.strip())[-1].strip()
    if not clause:
        return False
    first = clause.split()[0].strip(",").lower()
    if first not in QUESTION_OPENERS:
        return False
    # "What a day" and "How nice" are exclamations, not questions. A real
    # question needs a subject and a verb after the opener, and never puts a
    # determiner straight after a wh-word. Shallow, but it holds up in speech.
    tokens = [token.strip(",").lower() for token in clause.split()]
    if len(tokens) < 3:
        return False
    if tokens[1] in {"a", "an", "the"}:
        return False
    return True


_ABBREVIATIONS = {"mr", "mrs", "ms", "dr", "prof", "sr", "jr", "st", "vs", "etc", "e.g", "i.e"}


def _fix_capitalisation(
    text: str, opts: EnhanceOptions, changes: list[Change], *, continues_previous: bool = False
) -> str:
    before = text

    def capitalise_word(word: str) -> str:
        bare = re.sub(r"^\W+|\W+$", "", word)
        if not bare:
            return word
        lower = bare.lower()
        replacement = ACRONYMS.get(lower) or PROPER_NOUNS.get(lower)
        if replacement and bare != replacement:
            return word.replace(bare, replacement, 1)
        return word

    text = " ".join(capitalise_word(word) for word in text.split(" "))

    # Capitalise after every terminal mark, and at the very start unless this
    # caption continues the previous sentence.
    chars = list(text)
    expecting_capital = not continues_previous
    for index, char in enumerate(chars):
        if expecting_capital and char.isalpha():
            chars[index] = char.upper()
            expecting_capital = False
        elif char in ".!?":
            preceding = "".join(chars[max(0, index - 6) : index]).split()
            last = preceding[-1].lower().strip(".") if preceding else ""
            if last not in _ABBREVIATIONS:
                expecting_capital = True
        elif char == "\n":
            continue
    text = "".join(chars)
    if text != before:
        changes.append(Change("capitalization", before, text, "sentence case applied"))
    return text


def _apply_glossary(text: str, opts: EnhanceOptions, changes: list[Change]) -> str:
    if not opts.glossary:
        return text
    before = text
    for wrong, right in opts.glossary.items():
        if not wrong:
            continue
        text = re.sub(rf"\b{re.escape(wrong)}\b", right, text, flags=re.IGNORECASE)
    if text != before:
        changes.append(Change("grammar", before, text, "project glossary applied"))
    return text


def _smart_quotes(text: str, changes: list[Change]) -> str:
    before = text
    text = re.sub(r'(^|[\s(\[])"', r"\1“", text)
    text = text.replace('"', "”")
    text = re.sub(r"(^|[\s(\[])'", r"\1‘", text)
    text = re.sub(r"(\w)'(\w)", r"\1’\2", text)
    if text != before:
        changes.append(Change("readability", before, text, "typographic quotes"))
    return text


def _tidy_punctuation(text: str) -> str:
    text = re.sub(r"\s+([,.!?;:])", r"\1", text)
    text = re.sub(r"([,;:])(?=\S)", r"\1 ", text)
    text = re.sub(r"([.!?])(?=[A-Za-z])", r"\1 ", text)
    text = re.sub(r",\s*\.", ".", text)
    text = re.sub(r"([.!?]){2,}", r"\1", text)
    text = re.sub(r"\s{2,}", " ", text)
    return text.strip()


# --------------------------------------------------------------------------
# Optional local model
# --------------------------------------------------------------------------

_model = None
_model_failed = False


def model_status() -> dict:
    """Whether the optional punctuation model is installed locally."""
    try:
        import importlib.util

        spec = importlib.util.find_spec("deepmultilingualpunctuation")
    except Exception:
        spec = None
    return {
        "name": "deepmultilingualpunctuation",
        "installed": spec is not None,
        "loaded": _model is not None,
        "note": "Optional. The rule engine runs with or without it; the model only improves comma "
        "and full-stop placement in long unpunctuated passages. Weights must already be on disk — "
        "SubtitleForge never downloads them.",
    }


def _model_punctuate(text: str, changes: list[Change]) -> str:
    global _model, _model_failed
    if _model_failed:
        return text
    if _model is None:
        try:
            from deepmultilingualpunctuation import PunctuationModel  # type: ignore

            from ..core.config import get_settings

            # Point the cache at our own models directory and forbid any fetch.
            import os

            os.environ.setdefault("HF_HOME", str(get_settings().models_dir))
            os.environ.setdefault("TRANSFORMERS_OFFLINE", "1")
            os.environ.setdefault("HF_HUB_OFFLINE", "1")
            _model = PunctuationModel()
        except Exception:
            _model_failed = True
            return text
    try:
        restored = _model.restore_punctuation(text)
    except Exception:
        _model_failed = True
        return text
    if restored and restored != text:
        changes.append(Change("model", text, restored, "local punctuation model"))
        return restored
    return text
