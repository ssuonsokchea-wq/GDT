"""Speaker attribution.

Two paths, and the application is explicit with the user about which one ran.

**Accurate** — ``pyannote.audio``, if the user has installed it and placed its
pipeline weights in the models directory. It is the research-grade answer and
reports real speaker clusters.

**Built in** — a lightweight turn detector that needs nothing but NumPy. It
cuts the audio at pauses, describes each stretch of speech with a short
spectral fingerprint, and clusters the fingerprints. On a two-person interview
recorded on separate but consistent microphones it is usually right; on a noisy
panel it is not, and the UI labels its output as an estimate so a user never
ships speaker names they have not checked.

Either way the editor lets the user rename and reassign speakers, which is the
only thing that makes the feature trustworthy.
"""

from __future__ import annotations

import math
import wave
from dataclasses import dataclass
from pathlib import Path
from typing import Sequence

from ..core.config import get_settings
from .subtitles import Word

SPEAKER_COLORS = ["#38BDF8", "#FB7185", "#A3E635", "#FBBF24", "#C084FC", "#2DD4BF", "#F97316", "#94A3B8"]


@dataclass(slots=True)
class Turn:
    start_ms: int
    end_ms: int
    speaker: str

    def to_dict(self) -> dict:
        return {"startMs": self.start_ms, "endMs": self.end_ms, "speaker": self.speaker}


def backend_status() -> dict:
    try:
        import importlib.util

        pyannote = importlib.util.find_spec("pyannote.audio") is not None
    except Exception:
        pyannote = False
    try:
        import importlib.util

        numpy = importlib.util.find_spec("numpy") is not None
    except Exception:
        numpy = False
    return {
        "pyannote": {
            "installed": pyannote,
            "note": "Research-grade diarization. Needs its pipeline weights on disk; nothing is downloaded.",
        },
        "builtin": {
            "available": numpy,
            "note": "Pause-and-fingerprint estimate. Good for two clearly separated voices, "
            "unreliable on overlapping or noisy speech. Always presented as an estimate.",
        },
    }


def diarize(
    audio_path: str | Path,
    *,
    max_speakers: int = 4,
    min_turn_ms: int = 900,
    progress=None,
    should_cancel=None,
) -> tuple[list[Turn], str]:
    """Return speaker turns and the name of the method that produced them."""
    turns = _diarize_pyannote(audio_path, max_speakers=max_speakers)
    if turns is not None:
        if progress:
            progress(1.0, "speakers identified")
        return turns, "pyannote"
    turns = _diarize_builtin(
        audio_path, max_speakers=max_speakers, min_turn_ms=min_turn_ms, progress=progress, should_cancel=should_cancel
    )
    return turns, "builtin"


def assign_speakers(words: Sequence[Word], turns: Sequence[Turn]) -> list[str | None]:
    """Label each word with the turn that covers most of it."""
    if not turns:
        return [None] * len(words)
    labels: list[str | None] = []
    cursor = 0
    ordered = sorted(turns, key=lambda t: t.start_ms)
    for word in words:
        while cursor + 1 < len(ordered) and ordered[cursor].end_ms < word.start_ms:
            cursor += 1
        best, best_overlap = None, 0
        for turn in ordered[max(0, cursor - 1) : cursor + 2]:
            overlap = min(word.end_ms, turn.end_ms) - max(word.start_ms, turn.start_ms)
            if overlap > best_overlap:
                best, best_overlap = turn.speaker, overlap
        labels.append(best or (ordered[cursor].speaker if ordered else None))
    return labels


# --------------------------------------------------------------------------
# pyannote path
# --------------------------------------------------------------------------


def _diarize_pyannote(audio_path: str | Path, *, max_speakers: int) -> list[Turn] | None:
    config = get_settings().models_dir / "pyannote" / "config.yaml"
    if not config.exists():
        return None
    try:
        from pyannote.audio import Pipeline  # type: ignore

        pipeline = Pipeline.from_pretrained(str(config))
        annotation = pipeline(str(audio_path), max_speakers=max_speakers)
    except Exception:
        return None
    turns: list[Turn] = []
    for segment, _, label in annotation.itertracks(yield_label=True):
        turns.append(Turn(start_ms=int(segment.start * 1000), end_ms=int(segment.end * 1000), speaker=str(label)))
    return _merge_adjacent(turns)


# --------------------------------------------------------------------------
# Built-in path
# --------------------------------------------------------------------------

FRAME_MS = 32
HOP_MS = 16


def _diarize_builtin(
    audio_path: str | Path, *, max_speakers: int, min_turn_ms: int, progress=None, should_cancel=None
) -> list[Turn]:
    try:
        import numpy as np
    except Exception:
        return []

    samples, rate = _read_wav(audio_path)
    if samples is None or len(samples) == 0:
        return []
    if progress:
        progress(0.2, "detecting speech")

    frame = max(1, int(rate * FRAME_MS / 1000))
    hop = max(1, int(rate * HOP_MS / 1000))
    count = max(0, 1 + (len(samples) - frame) // hop)
    if count < 4:
        return []

    window = np.hanning(frame).astype("float32")
    energies = np.empty(count, dtype="float32")
    features = np.empty((count, 14), dtype="float32")
    freqs = np.fft.rfftfreq(frame, 1.0 / rate)
    # Mel-ish log-spaced bands: enough to separate two voices, cheap to compute.
    edges = np.geomspace(80, min(rate / 2 - 1, 7800), 15)
    band_index = [np.where((freqs >= edges[i]) & (freqs < edges[i + 1]))[0] for i in range(14)]

    for index in range(count):
        if should_cancel and should_cancel() and index % 512 == 0:
            from ..core.errors import JobCancelled

            raise JobCancelled("Speaker analysis cancelled")
        chunk = samples[index * hop : index * hop + frame] * window
        spectrum = np.abs(np.fft.rfft(chunk)) ** 2
        energies[index] = float(np.sqrt(np.mean(chunk**2)) + 1e-9)
        for band, idx in enumerate(band_index):
            features[index, band] = math.log(float(spectrum[idx].sum()) + 1e-9) if idx.size else -20.0
        if progress and index % 2000 == 0:
            progress(0.2 + 0.4 * index / count, "fingerprinting voices")

    # Speech/silence split from the energy distribution rather than a fixed
    # threshold, so a quiet lavalier and a hot shotgun both work.
    floor = float(np.percentile(energies, 15))
    ceiling = float(np.percentile(energies, 95))
    threshold = floor + 0.18 * max(ceiling - floor, 1e-6)
    speech = energies > threshold

    regions = _speech_regions(speech, hop, rate, min_turn_ms)
    if not regions:
        return []
    if progress:
        progress(0.7, "clustering speakers")

    vectors = []
    for start_frame, end_frame in regions:
        block = features[start_frame:end_frame]
        if block.size == 0:
            vectors.append(np.zeros(14, dtype="float32"))
            continue
        vector = block.mean(axis=0)
        vectors.append(vector)
    matrix = np.vstack(vectors)
    matrix = (matrix - matrix.mean(axis=0)) / (matrix.std(axis=0) + 1e-6)

    speakers = _estimate_speaker_count(matrix, max_speakers)
    labels = _kmeans(matrix, speakers)

    turns = [
        Turn(
            start_ms=int(start_frame * hop * 1000 / rate),
            end_ms=int((end_frame * hop + int(rate * FRAME_MS / 1000)) * 1000 / rate),
            speaker=f"SPEAKER_{labels[index]:02d}",
        )
        for index, (start_frame, end_frame) in enumerate(regions)
    ]
    if progress:
        progress(1.0, "speakers estimated")
    return _merge_adjacent(turns)


def _read_wav(path: str | Path):
    """Read the 16 kHz mono WAV produced for recognition."""
    try:
        import numpy as np
    except Exception:
        return None, 0
    try:
        with wave.open(str(path), "rb") as handle:
            rate = handle.getframerate()
            channels = handle.getnchannels()
            width = handle.getsampwidth()
            frames = handle.readframes(handle.getnframes())
    except Exception:
        return None, 0
    if width != 2:
        return None, 0
    data = np.frombuffer(frames, dtype="<i2").astype("float32") / 32768.0
    if channels > 1:
        data = data.reshape(-1, channels).mean(axis=1)
    return data, rate


def _speech_regions(speech, hop: int, rate: int, min_turn_ms: int) -> list[tuple[int, int]]:
    min_frames = max(1, int(min_turn_ms / HOP_MS))
    gap_frames = max(1, int(260 / HOP_MS))
    regions: list[list[int]] = []
    start = None
    silent = 0
    for index, is_speech in enumerate(speech):
        if is_speech:
            if start is None:
                start = index
            silent = 0
        elif start is not None:
            silent += 1
            if silent >= gap_frames:
                regions.append([start, index - silent])
                start, silent = None, 0
    if start is not None:
        regions.append([start, len(speech)])
    return [(a, b) for a, b in regions if b - a >= min_frames]


def _estimate_speaker_count(matrix, max_speakers: int) -> int:
    """Pick k by the elbow in within-cluster spread, capped by the user's limit."""
    import numpy as np

    limit = int(max(1, min(max_speakers, len(matrix))))
    if limit <= 1:
        return 1
    scores = {}
    for k in range(1, limit + 1):
        labels = _kmeans(matrix, k)
        centroids = np.vstack([matrix[labels == c].mean(axis=0) if (labels == c).any() else matrix.mean(axis=0)
                               for c in range(k)])
        spread = float(np.mean([np.linalg.norm(matrix[i] - centroids[labels[i]]) for i in range(len(matrix))]))
        scores[k] = spread
    best, best_gain = 1, 0.0
    for k in range(2, limit + 1):
        gain = (scores[k - 1] - scores[k]) / max(scores[1], 1e-6)
        if gain > 0.18 and gain > best_gain:
            best, best_gain = k, gain
    return best


def _kmeans(matrix, k: int, iterations: int = 24):
    import numpy as np

    k = max(1, min(k, len(matrix)))
    rng = np.random.default_rng(seed=7)  # deterministic: same audio, same labels
    centroids = matrix[rng.choice(len(matrix), size=k, replace=False)]
    labels = np.zeros(len(matrix), dtype="int32")
    for _ in range(iterations):
        distances = np.linalg.norm(matrix[:, None, :] - centroids[None, :, :], axis=2)
        new_labels = distances.argmin(axis=1).astype("int32")
        if (new_labels == labels).all():
            break
        labels = new_labels
        for cluster in range(k):
            members = matrix[labels == cluster]
            if len(members):
                centroids[cluster] = members.mean(axis=0)
    return labels


def _merge_adjacent(turns: list[Turn], gap_ms: int = 320) -> list[Turn]:
    ordered = sorted(turns, key=lambda t: t.start_ms)
    merged: list[Turn] = []
    for turn in ordered:
        if merged and merged[-1].speaker == turn.speaker and turn.start_ms - merged[-1].end_ms <= gap_ms:
            merged[-1].end_ms = max(merged[-1].end_ms, turn.end_ms)
        else:
            merged.append(Turn(turn.start_ms, turn.end_ms, turn.speaker))
    return merged
