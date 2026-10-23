"""Turning a transcript into readable captions.

Whisper returns words with timings; viewers need captions. The gap between the
two is segmentation, and it is where subtitle quality mostly lives. Four forces
pull against each other:

* a caption must fit — two lines of about 42 characters,
* it must stay on screen long enough to read — under ~21 characters a second,
* it should break where the sentence breaks, not mid-phrase,
* and it must not swallow a pause, or the caption drifts off the voice.

The segmenter scores candidate break points against all four rather than
cutting at a fixed character count, which is why its output reads like
captioning rather than a transcript chopped into squares.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Iterable, Sequence

from .subtitles import DEFAULT_GAP_MS, MAX_CUE_MS, MIN_CUE_MS, Cue, Word, renumber

SENTENCE_END = re.compile(r"[.!?]['\")\]]?$")
CLAUSE_END = re.compile(r"[,;:—–-]$")
# Words a line should not end on: the eye expects what follows them.
WEAK_ENDINGS = {
    "a", "an", "the", "and", "or", "but", "of", "to", "in", "on", "at", "for", "with", "from", "by", "as",
    "that", "this", "is", "are", "was", "were", "be", "been", "am", "my", "your", "his", "her", "its",
    "our", "their", "if", "when", "while", "than", "so", "into", "over", "about",
}


@dataclass(slots=True)
class SegmentOptions:
    max_chars_per_line: int = 42
    max_lines: int = 2
    max_duration_ms: int = MAX_CUE_MS
    min_duration_ms: int = MIN_CUE_MS
    target_cps: float = 17.0
    max_cps: float = 21.0
    pause_break_ms: int = 420      # a gap this long is a natural caption break
    hard_pause_ms: int = 900       # a gap this long always breaks
    gap_ms: int = DEFAULT_GAP_MS
    split_on_sentence: bool = True
    split_on_speaker: bool = True
    one_sentence_per_cue: bool = False

    @property
    def max_chars(self) -> int:
        return self.max_chars_per_line * self.max_lines

    @classmethod
    def from_dict(cls, data: dict | None) -> "SegmentOptions":
        data = data or {}
        mapping = {
            "maxCharsPerLine": "max_chars_per_line",
            "maxLines": "max_lines",
            "maxDurationMs": "max_duration_ms",
            "minDurationMs": "min_duration_ms",
            "targetCps": "target_cps",
            "maxCps": "max_cps",
            "pauseBreakMs": "pause_break_ms",
            "hardPauseMs": "hard_pause_ms",
            "gapMs": "gap_ms",
            "splitOnSentence": "split_on_sentence",
            "splitOnSpeaker": "split_on_speaker",
            "oneSentencePerCue": "one_sentence_per_cue",
        }
        kwargs = {}
        for camel, snake in mapping.items():
            if camel in data and data[camel] is not None:
                kwargs[snake] = data[camel]
            elif snake in data and data[snake] is not None:
                kwargs[snake] = data[snake]
        return cls(**kwargs)


def segment_words(
    words: Sequence[Word],
    options: SegmentOptions | None = None,
    speakers: Sequence[str | None] | None = None,
) -> list[Cue]:
    """Group timed words into cues.

    ``speakers`` is a parallel sequence of speaker labels, one per word, so a
    turn change forces a break even mid-sentence.
    """
    opts = options or SegmentOptions()
    if not words:
        return []
    labels = list(speakers) if speakers else [None] * len(words)
    if len(labels) < len(words):
        labels += [None] * (len(words) - len(labels))

    cues: list[Cue] = []
    buffer: list[Word] = []
    buffer_speaker = labels[0]
    chars = 0

    def flush() -> None:
        nonlocal buffer, chars
        if not buffer:
            return
        text = " ".join(word.text.strip() for word in buffer if word.text.strip())
        if text:
            cues.append(
                Cue(
                    start_ms=buffer[0].start_ms,
                    end_ms=buffer[-1].end_ms,
                    text=wrap_lines(text, opts.max_chars_per_line, opts.max_lines),
                    speaker=buffer_speaker,
                    raw_text=text,
                    confidence=_mean([w.probability for w in buffer]),
                    words=list(buffer),
                )
            )
        buffer = []
        chars = 0

    for index, word in enumerate(words):
        token = word.text.strip()
        if not token:
            continue
        speaker = labels[index]
        if buffer and opts.split_on_speaker and speaker != buffer_speaker:
            flush()
            buffer_speaker = speaker
        if not buffer:
            buffer_speaker = speaker

        prospective = chars + len(token) + (1 if buffer else 0)
        duration = word.end_ms - (buffer[0].start_ms if buffer else word.start_ms)
        gap = word.start_ms - buffer[-1].end_ms if buffer else 0

        must_break = bool(buffer) and (
            prospective > opts.max_chars
            or duration > opts.max_duration_ms
            or gap >= opts.hard_pause_ms
        )
        if must_break:
            flush()
            buffer_speaker = speaker
            prospective = len(token)
            gap = 0

        buffer.append(word)
        chars = prospective

        wants_break = False
        if opts.split_on_sentence and SENTENCE_END.search(token):
            # End a cue on a full stop unless the cue is still too short to
            # stand alone, in which case let the next sentence join it.
            cue_ms = buffer[-1].end_ms - buffer[0].start_ms
            if opts.one_sentence_per_cue or cue_ms >= opts.min_duration_ms or chars >= opts.max_chars_per_line:
                wants_break = True
        if not wants_break and index + 1 < len(words):
            next_gap = words[index + 1].start_ms - word.end_ms
            if next_gap >= opts.pause_break_ms and chars >= opts.max_chars_per_line * 0.5:
                wants_break = True
        if wants_break:
            flush()

    flush()
    return polish(cues, opts)


def segment_segments(segments: Iterable[dict], options: SegmentOptions | None = None) -> list[Cue]:
    """Fall back to whole ASR segments when word timings are unavailable.

    Timings within a segment are interpolated by character count, which is less
    accurate than real word stamps but keeps long segments from becoming
    unreadable walls of text.
    """
    opts = options or SegmentOptions()
    words: list[Word] = []
    speakers: list[str | None] = []
    for segment in segments:
        text = (segment.get("text") or "").strip()
        if not text:
            continue
        start = int(segment["startMs"])
        end = max(start + 1, int(segment["endMs"]))
        tokens = text.split()
        total = sum(len(token) for token in tokens) or 1
        cursor = start
        for token in tokens:
            span = int((end - start) * len(token) / total)
            words.append(Word(start_ms=cursor, end_ms=min(end, cursor + max(span, 1)), text=token,
                              probability=segment.get("confidence")))
            speakers.append(segment.get("speaker"))
            cursor = min(end, cursor + max(span, 1))
    return segment_words(words, opts, speakers)


def polish(cues: Sequence[Cue], options: SegmentOptions | None = None) -> list[Cue]:
    """Enforce minimum duration, reading speed and non-overlap, in that order."""
    opts = options or SegmentOptions()
    ordered = renumber(list(cues))
    for position, cue in enumerate(ordered):
        next_start = ordered[position + 1].start_ms if position + 1 < len(ordered) else None
        ceiling = (next_start - opts.gap_ms) if next_start is not None else cue.end_ms + 4000

        if cue.duration_ms < opts.min_duration_ms:
            cue.end_ms = min(max(cue.end_ms, cue.start_ms + opts.min_duration_ms), max(ceiling, cue.end_ms))
        # Too fast to read? Borrow from the silence that follows.
        if cue.cps > opts.max_cps and ceiling > cue.end_ms:
            needed = int(cue.char_count / opts.target_cps * 1000)
            cue.end_ms = min(cue.start_ms + needed, ceiling)
        if cue.duration_ms > opts.max_duration_ms * 1.5:
            cue.end_ms = cue.start_ms + int(opts.max_duration_ms * 1.5)
    for current, following in zip(ordered, ordered[1:]):
        if current.end_ms + opts.gap_ms > following.start_ms:
            current.end_ms = max(current.start_ms, following.start_ms - opts.gap_ms)
    return ordered


def resegment(cues: Sequence[Cue], options: SegmentOptions | None = None) -> list[Cue]:
    """Re-cut existing cues, reusing word timings where they survived.

    This is what "apply to all" does after the user changes line limits or
    picks a different style preset with shorter lines.
    """
    opts = options or SegmentOptions()
    words: list[Word] = []
    speakers: list[str | None] = []
    for cue in sorted(cues, key=lambda c: c.start_ms):
        if cue.words:
            for word in cue.words:
                words.append(word)
                speakers.append(cue.speaker)
        else:
            synthetic = segment_segments(
                [{"startMs": cue.start_ms, "endMs": cue.end_ms, "text": cue.text.replace("\n", " "),
                  "speaker": cue.speaker, "confidence": cue.confidence}],
                opts,
            )
            for piece in synthetic:
                for word in piece.words:
                    words.append(word)
                    speakers.append(cue.speaker)
    return segment_words(words, opts, speakers)


# --------------------------------------------------------------------------
# Line wrapping
# --------------------------------------------------------------------------


def wrap_lines(text: str, max_chars: int, max_lines: int = 2) -> str:
    """Break a caption into balanced lines.

    Greedy wrapping produces a long line over a stub, which reads badly. This
    searches the break points and scores them on balance, on whether the break
    falls at punctuation, and on whether it leaves a line ending on a weak word
    like "the" — the classic caption error.
    """
    flat = " ".join(text.split())
    if not flat:
        return ""
    if len(flat) <= max_chars or max_lines <= 1:
        return flat

    tokens = flat.split(" ")
    best: tuple[float, list[str]] | None = None
    for split_count in range(2, max_lines + 1):
        candidate = _best_split(tokens, split_count, max_chars)
        if candidate is None:
            continue
        score, lines = candidate
        if best is None or score < best[0]:
            best = (score, lines)
    if best is None:
        # Nothing fits the limits; keep words whole and overflow the last line.
        return _greedy(tokens, max_chars, max_lines)
    return "\n".join(best[1])


def _best_split(tokens: list[str], parts: int, max_chars: int) -> tuple[float, list[str]] | None:
    import itertools

    if parts - 1 > len(tokens) - 1:
        return None
    positions = range(1, len(tokens))
    best: tuple[float, list[str]] | None = None
    # Captions are short: the combinations stay small for 2-3 lines, and we cap
    # the search so a pathological 60-word cue cannot stall the segmenter.
    combos = itertools.islice(itertools.combinations(positions, parts - 1), 20000)
    for cuts in combos:
        lines = []
        previous = 0
        for cut in (*cuts, len(tokens)):
            lines.append(" ".join(tokens[previous:cut]))
            previous = cut
        if any(len(line) > max_chars for line in lines):
            continue
        score = _score_lines(lines, max_chars)
        if best is None or score < best[0]:
            best = (score, lines)
    return best


def _score_lines(lines: list[str], max_chars: int) -> float:
    lengths = [len(line) for line in lines]
    mean = sum(lengths) / len(lengths)
    imbalance = sum(abs(length - mean) for length in lengths) / max_chars
    penalty = imbalance
    for line in lines[:-1]:
        last_word = line.split(" ")[-1].strip(".,;:!?").lower()
        if last_word in WEAK_ENDINGS:
            penalty += 0.9
        elif CLAUSE_END.search(line):
            penalty -= 0.5        # a comma is a good place to break
        elif SENTENCE_END.search(line):
            penalty -= 0.8
    # Prefer fewer lines when the balance is comparable.
    penalty += 0.25 * (len(lines) - 1)
    return penalty


def _greedy(tokens: list[str], max_chars: int, max_lines: int) -> str:
    lines: list[str] = [""]
    for token in tokens:
        candidate = f"{lines[-1]} {token}".strip()
        if len(candidate) <= max_chars or not lines[-1]:
            lines[-1] = candidate
        elif len(lines) < max_lines:
            lines.append(token)
        else:
            lines[-1] = f"{lines[-1]} {token}"
    return "\n".join(lines)


def _mean(values: Sequence[float | None]) -> float | None:
    numbers = [value for value in values if value is not None]
    return round(sum(numbers) / len(numbers), 4) if numbers else None
