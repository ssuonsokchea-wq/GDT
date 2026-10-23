"""Subtitle model and file formats.

A cue is the unit of everything: the editor edits cues, the renderer draws
cues, the exporters serialise cues. Keeping one representation and converting
at the edges is what stops SRT, VTT and ASS from drifting apart.

Timings are integer milliseconds throughout. ASS stores centiseconds, so
export rounds; import multiplies. Round-tripping SRT and VTT is exact.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field, replace
from pathlib import Path
from typing import Iterable, Sequence

from ..core.errors import AppError

# --------------------------------------------------------------------------
# Timecodes
# --------------------------------------------------------------------------


def ms_to_srt(ms: int) -> str:
    ms = max(0, int(round(ms)))
    hours, rest = divmod(ms, 3_600_000)
    minutes, rest = divmod(rest, 60_000)
    seconds, millis = divmod(rest, 1000)
    return f"{hours:02d}:{minutes:02d}:{seconds:02d},{millis:03d}"


def ms_to_vtt(ms: int) -> str:
    return ms_to_srt(ms).replace(",", ".")


def ms_to_ass(ms: int) -> str:
    """ASS uses one-digit hours and centiseconds: ``0:00:01.50``."""
    ms = max(0, int(round(ms)))
    centis = int(round(ms / 10))
    hours, rest = divmod(centis, 360_000)
    minutes, rest = divmod(rest, 6_000)
    seconds, cs = divmod(rest, 100)
    return f"{hours:d}:{minutes:02d}:{seconds:02d}.{cs:02d}"


_TIME_RE = re.compile(
    r"(?:(?P<h>\d{1,3}):)?(?P<m>\d{1,2}):(?P<s>\d{1,2})(?:[.,](?P<frac>\d{1,3}))?"
)


def parse_timecode(text: str) -> int:
    match = _TIME_RE.fullmatch(text.strip())
    if not match:
        raise AppError(f"Not a timecode: {text!r}", code="bad_timecode")
    hours = int(match.group("h") or 0)
    minutes = int(match.group("m"))
    seconds = int(match.group("s"))
    frac = match.group("frac") or "0"
    millis = int(frac.ljust(3, "0")[:3])
    return hours * 3_600_000 + minutes * 60_000 + seconds * 1000 + millis


# --------------------------------------------------------------------------
# Cue
# --------------------------------------------------------------------------

MIN_CUE_MS = 700          # below this a caption flashes
MAX_CUE_MS = 7000         # above this it overstays
DEFAULT_GAP_MS = 80       # frame-ish gap so two cues never touch


@dataclass(slots=True)
class Cue:
    start_ms: int
    end_ms: int
    text: str
    id: str | None = None
    idx: int = 0
    speaker: str | None = None
    confidence: float | None = None
    raw_text: str | None = None
    style_override: dict | None = None
    locked: bool = False
    words: list["Word"] = field(default_factory=list)

    @property
    def duration_ms(self) -> int:
        return max(0, self.end_ms - self.start_ms)

    @property
    def lines(self) -> list[str]:
        return [line for line in self.text.split("\n")]

    @property
    def char_count(self) -> int:
        return len(self.text.replace("\n", " "))

    @property
    def cps(self) -> float:
        """Characters per second — the readability number broadcasters check."""
        seconds = self.duration_ms / 1000
        return round(self.char_count / seconds, 1) if seconds > 0 else 0.0

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "idx": self.idx,
            "startMs": self.start_ms,
            "endMs": self.end_ms,
            "text": self.text,
            "rawText": self.raw_text,
            "speaker": self.speaker,
            "confidence": self.confidence,
            "styleOverride": self.style_override,
            "locked": self.locked,
            "cps": self.cps,
            "words": [w.to_dict() for w in self.words],
        }

    @classmethod
    def from_dict(cls, data: dict) -> "Cue":
        # Values arrive from JSON, where an absent field and an explicit null
        # are both common; neither should raise.
        return cls(
            start_ms=int(data.get("startMs") or data.get("start_ms") or 0),
            end_ms=int(data.get("endMs") or data.get("end_ms") or 0),
            text=data.get("text") or "",
            id=data.get("id"),
            idx=int(data.get("idx") or 0),
            speaker=data.get("speaker"),
            confidence=data.get("confidence"),
            raw_text=data.get("rawText") or data.get("raw_text"),
            style_override=data.get("styleOverride") or data.get("style_override"),
            locked=bool(data.get("locked", False)),
            words=[Word.from_dict(w) for w in data.get("words", []) or []],
        )


@dataclass(slots=True)
class Word:
    start_ms: int
    end_ms: int
    text: str
    probability: float | None = None

    def to_dict(self) -> dict:
        return {"startMs": self.start_ms, "endMs": self.end_ms, "text": self.text, "probability": self.probability}

    @classmethod
    def from_dict(cls, data: dict) -> "Word":
        return cls(
            start_ms=int(data.get("startMs") or data.get("start_ms") or 0),
            end_ms=int(data.get("endMs") or data.get("end_ms") or 0),
            text=data.get("text") or "",
            probability=data.get("probability"),
        )


# --------------------------------------------------------------------------
# Editing operations
# --------------------------------------------------------------------------


def renumber(cues: Sequence[Cue]) -> list[Cue]:
    ordered = sorted(cues, key=lambda c: (c.start_ms, c.end_ms))
    for position, cue in enumerate(ordered, start=1):
        cue.idx = position
    return list(ordered)


def resolve_overlaps(cues: Sequence[Cue], gap_ms: int = DEFAULT_GAP_MS) -> list[Cue]:
    """Pull back any cue that runs into the next one.

    Dragging a cue in the timeline is the common cause. Shortening the earlier
    cue is less disruptive than moving the later one, which would desynchronise
    everything after it.
    """
    ordered = renumber(cues)
    for current, following in zip(ordered, ordered[1:]):
        if current.end_ms + gap_ms > following.start_ms:
            current.end_ms = max(current.start_ms, following.start_ms - gap_ms)
    return ordered


def split_cue(cue: Cue, at_ms: int | None = None, at_char: int | None = None) -> tuple[Cue, Cue]:
    """Split one cue into two, by time, by caret position, or by both.

    With word timings available the text split picks the real boundary time
    instead of interpolating, which is what keeps a split caption in sync.
    """
    if at_char is None and at_ms is None:
        at_ms = cue.start_ms + cue.duration_ms // 2
    flat = cue.text.replace("\n", " ")

    if at_char is not None:
        at_char = max(1, min(len(flat) - 1, at_char)) if len(flat) > 1 else 1
        left_text, right_text = flat[:at_char].strip(), flat[at_char:].strip()
        if at_ms is None:
            at_ms = _time_for_char(cue, at_char, flat)
    else:
        at_ms = max(cue.start_ms + 1, min(cue.end_ms - 1, int(at_ms)))
        split_char = _char_for_time(cue, at_ms, flat)
        left_text, right_text = flat[:split_char].strip(), flat[split_char:].strip()

    at_ms = max(cue.start_ms + 1, min(cue.end_ms - 1, int(at_ms)))
    left = replace(cue, id=None, end_ms=at_ms, text=left_text or flat, words=[w for w in cue.words if w.start_ms < at_ms])
    right = replace(
        cue, id=None, start_ms=at_ms, text=right_text or "", words=[w for w in cue.words if w.start_ms >= at_ms]
    )
    return left, right


def _time_for_char(cue: Cue, char_index: int, flat: str) -> int:
    if cue.words:
        consumed = 0
        for word in cue.words:
            consumed += len(word.text) + 1
            if consumed >= char_index:
                return word.end_ms
    ratio = char_index / max(1, len(flat))
    return cue.start_ms + int(cue.duration_ms * ratio)


def _char_for_time(cue: Cue, at_ms: int, flat: str) -> int:
    if cue.words:
        consumed = 0
        for word in cue.words:
            if word.end_ms >= at_ms:
                return max(1, consumed)
            consumed += len(word.text) + 1
    ratio = (at_ms - cue.start_ms) / max(1, cue.duration_ms)
    # Prefer the nearest space so a split never lands inside a word.
    target = int(len(flat) * ratio)
    left_space = flat.rfind(" ", 0, target)
    right_space = flat.find(" ", target)
    candidates = [c for c in (left_space, right_space) if c > 0]
    return min(candidates, key=lambda c: abs(c - target)) if candidates else max(1, target)


def merge_cues(cues: Sequence[Cue], separator: str = " ") -> Cue:
    if not cues:
        raise AppError("Nothing to merge", code="empty_merge")
    ordered = sorted(cues, key=lambda c: c.start_ms)
    text = separator.join(c.text.replace("\n", " ").strip() for c in ordered if c.text.strip())
    words: list[Word] = []
    for cue in ordered:
        words.extend(cue.words)
    confidences = [c.confidence for c in ordered if c.confidence is not None]
    return Cue(
        start_ms=ordered[0].start_ms,
        end_ms=ordered[-1].end_ms,
        text=text,
        speaker=ordered[0].speaker,
        confidence=sum(confidences) / len(confidences) if confidences else None,
        words=words,
    )


def shift(cues: Sequence[Cue], delta_ms: int, *, from_ms: int = 0) -> list[Cue]:
    """Shift timings — the fix for an audio offset discovered after transcription."""
    for cue in cues:
        if cue.start_ms >= from_ms:
            cue.start_ms = max(0, cue.start_ms + delta_ms)
            cue.end_ms = max(cue.start_ms, cue.end_ms + delta_ms)
            for word in cue.words:
                word.start_ms = max(0, word.start_ms + delta_ms)
                word.end_ms = max(0, word.end_ms + delta_ms)
    return renumber(cues)


def rescale(cues: Sequence[Cue], factor: float) -> list[Cue]:
    """Stretch timings, for a transcript cut against a different frame rate."""
    for cue in cues:
        # Round rather than truncate: a 1.001 factor truncated would leave
        # every timestamp one millisecond short of where it belongs.
        cue.start_ms = int(round(cue.start_ms * factor))
        cue.end_ms = int(round(cue.end_ms * factor))
        for word in cue.words:
            word.start_ms = int(round(word.start_ms * factor))
            word.end_ms = int(round(word.end_ms * factor))
    return renumber(cues)


# --------------------------------------------------------------------------
# Writers
# --------------------------------------------------------------------------


def write_srt(cues: Sequence[Cue], *, include_speakers: bool = False) -> str:
    blocks = []
    for position, cue in enumerate(renumber(cues), start=1):
        text = cue.text.strip()
        if include_speakers and cue.speaker:
            text = f"{cue.speaker}: {text}"
        if not text:
            continue
        blocks.append(f"{position}\n{ms_to_srt(cue.start_ms)} --> {ms_to_srt(cue.end_ms)}\n{text}")
    return "\n\n".join(blocks) + ("\n" if blocks else "")


def write_vtt(cues: Sequence[Cue], *, include_speakers: bool = False, cue_ids: bool = True) -> str:
    out = ["WEBVTT", ""]
    for position, cue in enumerate(renumber(cues), start=1):
        text = cue.text.strip()
        if not text:
            continue
        if include_speakers and cue.speaker:
            # WebVTT's own voice span: styleable with ::cue(v[voice="Host"]).
            text = f"<v {cue.speaker}>{text}"
        if cue_ids:
            out.append(str(position))
        out.append(f"{ms_to_vtt(cue.start_ms)} --> {ms_to_vtt(cue.end_ms)}")
        out.append(text)
        out.append("")
    return "\n".join(out)


def write_ass(
    cues: Sequence[Cue],
    *,
    style: dict | None = None,
    play_res: tuple[int, int] = (1920, 1080),
    title: str = "SubtitleForge AI",
    include_speakers: bool = False,
    speaker_styles: dict[str, dict] | None = None,
) -> str:
    from .styles import ass_style_line, ass_header_defaults, normalise_style

    base = normalise_style(style or {})
    styles = {"Default": base}
    if speaker_styles:
        for name, override in speaker_styles.items():
            styles[_ass_safe_name(name)] = normalise_style({**base, **override})

    width, height = play_res
    header = ass_header_defaults(title=title, width=width, height=height, style=base)
    style_lines = "\n".join(ass_style_line(name, spec, (width, height)) for name, spec in styles.items())
    events = []
    for cue in renumber(cues):
        text = cue.text.strip()
        if not text:
            continue
        if include_speakers and cue.speaker:
            text = f"{cue.speaker}: {text}"
        style_name = _ass_safe_name(cue.speaker) if (speaker_styles and cue.speaker and _ass_safe_name(cue.speaker) in styles) else "Default"
        body = text.replace("\\", "\\\\").replace("\n", "\\N")
        override = _cue_override(cue)
        events.append(
            f"Dialogue: 0,{ms_to_ass(cue.start_ms)},{ms_to_ass(cue.end_ms)},{style_name},"
            f"{(cue.speaker or '')},0,0,0,,{override}{body}"
        )
    return f"{header}\n[V4+ Styles]\n{_ASS_STYLE_FORMAT}\n{style_lines}\n\n[Events]\n{_ASS_EVENT_FORMAT}\n" + "\n".join(events) + "\n"


_ASS_STYLE_FORMAT = (
    "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic,"
    " Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL,"
    " MarginR, MarginV, Encoding"
)
_ASS_EVENT_FORMAT = "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text"


def _ass_safe_name(name: str | None) -> str:
    if not name:
        return "Default"
    return re.sub(r"[,\[\]\n]", "", name).strip() or "Default"


def _cue_override(cue: Cue) -> str:
    """Per-cue ASS override tags, for a caption nudged off the default position."""
    if not cue.style_override:
        return ""
    tags = []
    override = cue.style_override
    if "alignment" in override:
        tags.append(f"\\an{int(override['alignment'])}")
    if "positionX" in override and "positionY" in override:
        tags.append(f"\\pos({int(override['positionX'])},{int(override['positionY'])})")
    if override.get("italic"):
        tags.append("\\i1")
    if override.get("bold"):
        tags.append("\\b1")
    if "fontSize" in override:
        tags.append(f"\\fs{int(override['fontSize'])}")
    if "primaryColor" in override:
        from .styles import to_ass_color

        tags.append(f"\\c{to_ass_color(override['primaryColor'])}")
    return "{" + "".join(tags) + "}" if tags else ""


WRITERS = {"srt": write_srt, "vtt": write_vtt, "ass": write_ass}


def write(cues: Sequence[Cue], fmt: str, **kwargs) -> str:
    fmt = fmt.lower().lstrip(".")
    if fmt not in WRITERS:
        raise AppError(f"Unsupported subtitle format: {fmt}", code="bad_subtitle_format")
    if fmt != "ass":
        kwargs.pop("style", None)
        kwargs.pop("play_res", None)
        kwargs.pop("title", None)
        kwargs.pop("speaker_styles", None)
    return WRITERS[fmt](cues, **kwargs)  # type: ignore[operator]


# --------------------------------------------------------------------------
# Readers
# --------------------------------------------------------------------------

_ARROW = re.compile(r"(?P<start>[\d:.,]+)\s*-->\s*(?P<end>[\d:.,]+)")
_VOICE = re.compile(r"^<v(?:\.\w+)*\s+([^>]+)>")
_TAG = re.compile(r"</?[^>]+>")
_SPEAKER_PREFIX = re.compile(r"^(?P<name>[A-Z][\w .'-]{0,30}):\s+")


def read_srt(text: str) -> list[Cue]:
    return _read_cue_blocks(text)


def read_vtt(text: str) -> list[Cue]:
    body = text
    if body.lstrip().upper().startswith("WEBVTT"):
        body = body.split("\n", 1)[1] if "\n" in body else ""
    # Drop NOTE, STYLE and REGION blocks, which carry no cues.
    cleaned = []
    skipping = False
    for line in body.splitlines():
        if re.match(r"^(NOTE|STYLE|REGION)\b", line.strip()):
            skipping = True
            continue
        if skipping:
            if not line.strip():
                skipping = False
            continue
        cleaned.append(line)
    return _read_cue_blocks("\n".join(cleaned), vtt=True)


def _read_cue_blocks(text: str, vtt: bool = False) -> list[Cue]:
    cues: list[Cue] = []
    blocks = re.split(r"\n\s*\n", text.replace("\r\n", "\n").replace("\r", "\n").strip())
    for block in blocks:
        lines = [line for line in block.split("\n") if line.strip() != ""]
        if not lines:
            continue
        timing_index = next((i for i, line in enumerate(lines) if _ARROW.search(line)), None)
        if timing_index is None:
            continue
        match = _ARROW.search(lines[timing_index])
        assert match
        try:
            start = parse_timecode(match.group("start"))
            end = parse_timecode(match.group("end"))
        except AppError:
            continue
        body_lines = lines[timing_index + 1 :]
        speaker = None
        if body_lines:
            voice = _VOICE.match(body_lines[0])
            if voice:
                speaker = voice.group(1).strip()
                body_lines[0] = _VOICE.sub("", body_lines[0])
        body = "\n".join(body_lines).strip()
        if vtt:
            body = _TAG.sub("", body)
        if speaker is None:
            prefix = _SPEAKER_PREFIX.match(body)
            if prefix and "\n" not in prefix.group(0):
                speaker = prefix.group("name")
                body = body[prefix.end():]
        cues.append(Cue(start_ms=start, end_ms=max(start, end), text=body, speaker=speaker))
    return renumber(cues)


_ASS_DIALOGUE = re.compile(r"^Dialogue:\s*(?P<fields>.*)$")
_ASS_TAGS = re.compile(r"\{[^}]*\}")


def read_ass(text: str) -> list[Cue]:
    cues: list[Cue] = []
    event_format: list[str] = []
    for line in text.replace("\r\n", "\n").splitlines():
        stripped = line.strip()
        if stripped.startswith("Format:") and not event_format and "Start" in stripped:
            event_format = [f.strip() for f in stripped[len("Format:"):].split(",")]
            continue
        match = _ASS_DIALOGUE.match(stripped)
        if not match or not event_format:
            continue
        parts = match.group("fields").split(",", len(event_format) - 1)
        if len(parts) < len(event_format):
            continue
        row = dict(zip(event_format, parts))
        try:
            start = parse_timecode(row.get("Start", "0:00:00.00"))
            end = parse_timecode(row.get("End", "0:00:00.00"))
        except AppError:
            continue
        body = row.get("Text", "")
        body = _ASS_TAGS.sub("", body).replace("\\N", "\n").replace("\\n", "\n").replace("\\h", " ")
        speaker = (row.get("Name") or "").strip() or None
        cues.append(Cue(start_ms=start, end_ms=max(start, end), text=body.strip(), speaker=speaker))
    return renumber(cues)


READERS = {"srt": read_srt, "vtt": read_vtt, "ass": read_ass, "ssa": read_ass}


def read(text: str, fmt: str) -> list[Cue]:
    fmt = fmt.lower().lstrip(".")
    if fmt not in READERS:
        raise AppError(f"Cannot import {fmt} subtitles", code="bad_subtitle_format")
    return READERS[fmt](text)


def read_file(path: str | Path) -> list[Cue]:
    file_path = Path(path)
    fmt = file_path.suffix.lower().lstrip(".")
    # Subtitle files in the wild are frequently Windows-1252 or UTF-16.
    for encoding in ("utf-8-sig", "utf-8", "utf-16", "cp1252", "latin-1"):
        try:
            return read(file_path.read_text(encoding=encoding), fmt)
        except UnicodeDecodeError:
            continue
    raise AppError(f"Could not decode {file_path.name}", code="bad_encoding")


# --------------------------------------------------------------------------
# Quality report
# --------------------------------------------------------------------------

CPS_WARN = 21.0   # Netflix English limit
CPS_FAIL = 27.0
MAX_LINE_CHARS = 42
MAX_LINES = 2


def quality_report(cues: Sequence[Cue]) -> dict:
    """What a professional QC pass checks: reading speed, line length, gaps."""
    issues: list[dict] = []
    ordered = renumber(cues)
    for cue in ordered:
        if cue.duration_ms < MIN_CUE_MS and cue.text.strip():
            issues.append({"cueIdx": cue.idx, "kind": "too_short", "severity": "warn",
                           "message": f"{cue.duration_ms} ms is below the {MIN_CUE_MS} ms minimum"})
        if cue.duration_ms > MAX_CUE_MS:
            issues.append({"cueIdx": cue.idx, "kind": "too_long", "severity": "info",
                           "message": f"{cue.duration_ms / 1000:.1f} s on screen"})
        if cue.cps > CPS_FAIL:
            issues.append({"cueIdx": cue.idx, "kind": "reading_speed", "severity": "error",
                           "message": f"{cue.cps} characters per second"})
        elif cue.cps > CPS_WARN:
            issues.append({"cueIdx": cue.idx, "kind": "reading_speed", "severity": "warn",
                           "message": f"{cue.cps} characters per second"})
        for line in cue.lines:
            if len(line) > MAX_LINE_CHARS:
                issues.append({"cueIdx": cue.idx, "kind": "line_length", "severity": "warn",
                               "message": f"{len(line)} characters in one line"})
                break
        if len(cue.lines) > MAX_LINES:
            issues.append({"cueIdx": cue.idx, "kind": "line_count", "severity": "warn",
                           "message": f"{len(cue.lines)} lines"})
        if not cue.text.strip():
            issues.append({"cueIdx": cue.idx, "kind": "empty", "severity": "error", "message": "Empty cue"})
    for current, following in zip(ordered, ordered[1:]):
        if following.start_ms < current.end_ms:
            issues.append({"cueIdx": current.idx, "kind": "overlap", "severity": "error",
                           "message": f"Overlaps cue {following.idx} by {current.end_ms - following.start_ms} ms"})
    total_chars = sum(c.char_count for c in ordered)
    speaking_ms = sum(c.duration_ms for c in ordered)
    return {
        "cueCount": len(ordered),
        "totalChars": total_chars,
        "speakingMs": speaking_ms,
        "averageCps": round(total_chars / (speaking_ms / 1000), 1) if speaking_ms else 0,
        "issues": issues,
        "counts": {
            "error": sum(1 for i in issues if i["severity"] == "error"),
            "warn": sum(1 for i in issues if i["severity"] == "warn"),
            "info": sum(1 for i in issues if i["severity"] == "info"),
        },
    }
