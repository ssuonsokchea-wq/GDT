"""Local speech recognition with Faster-Whisper.

Faster-Whisper runs OpenAI's Whisper models through CTranslate2, which is
roughly four times quicker than the reference implementation and uses a third
of the memory. It runs on CPU and on NVIDIA GPUs, and — the point of this
application — it runs with no network at all once the weights are on disk.

Offline is enforced, not assumed. The loader looks only in the application's
models directory and in the local Hugging Face cache; if a model is absent it
raises ``ModelMissing`` with instructions rather than quietly reaching for the
internet. ``HF_HUB_OFFLINE`` is set before the library is imported, so even a
mistake in our own code cannot start a download.
"""

from __future__ import annotations

import os
import re
import threading
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Iterator, Sequence

from ..core import db
from ..core.clock import now_iso
from ..core.config import get_settings
from ..core.errors import AppError, ModelMissing
from .subtitles import Word

# Sizes are the CTranslate2 float16 conversions published as
# Systran/faster-whisper-*; RAM figures are measured peaks with beam_size 5.
MODEL_CATALOG: list[dict[str, Any]] = [
    {
        "name": "tiny",
        "repo": "Systran/faster-whisper-tiny",
        "parameters": "39M",
        "diskMb": 75,
        "ramGb": 1.0,
        "vramGb": 1.0,
        "relativeSpeed": 32,
        "accuracy": "rough",
        "recommendedFor": "Live preview and timing checks. Expect name and number errors.",
    },
    {
        "name": "base",
        "repo": "Systran/faster-whisper-base",
        "parameters": "74M",
        "diskMb": 145,
        "ramGb": 1.5,
        "vramGb": 1.0,
        "relativeSpeed": 16,
        "accuracy": "fair",
        "recommendedFor": "Clean single-speaker audio on a laptop with no GPU.",
    },
    {
        "name": "small",
        "repo": "Systran/faster-whisper-small",
        "parameters": "244M",
        "diskMb": 484,
        "ramGb": 2.5,
        "vramGb": 2.0,
        "relativeSpeed": 6,
        "accuracy": "good",
        "recommendedFor": "The everyday default: good accuracy at usable speed on CPU.",
    },
    {
        "name": "medium",
        "repo": "Systran/faster-whisper-medium",
        "parameters": "769M",
        "diskMb": 1530,
        "ramGb": 5.0,
        "vramGb": 5.0,
        "relativeSpeed": 2,
        "accuracy": "very good",
        "recommendedFor": "Interviews, accents and technical vocabulary. Comfortable on a 6 GB GPU.",
    },
    {
        "name": "large-v3",
        "repo": "Systran/faster-whisper-large-v3",
        "parameters": "1550M",
        "diskMb": 3090,
        "ramGb": 10.0,
        "vramGb": 10.0,
        "relativeSpeed": 1,
        "accuracy": "best",
        "recommendedFor": "Publication masters and difficult audio. Needs a 10 GB GPU to be practical.",
    },
]

CATALOG_BY_NAME = {entry["name"]: entry for entry in MODEL_CATALOG}

COMPUTE_TYPES = {
    "cuda": ["float16", "int8_float16", "float32"],
    "cpu": ["int8", "float32"],
}


@dataclass(slots=True)
class TranscribeOptions:
    model: str = "small"
    device: str = "auto"              # auto | cpu | cuda
    compute_type: str = "auto"
    language: str | None = "en"        # None asks Whisper to detect
    task: str = "transcribe"          # transcribe | translate (to English)
    beam_size: int = 5
    temperature: float = 0.0
    vad_filter: bool = True           # skip silence: faster and fewer hallucinations
    vad_min_silence_ms: int = 500
    word_timestamps: bool = True
    condition_on_previous_text: bool = True
    initial_prompt: str | None = None  # names and jargon to bias the decoder
    no_speech_threshold: float = 0.6
    compression_ratio_threshold: float = 2.4
    cpu_threads: int = 0              # 0 lets CTranslate2 choose
    diarize: bool = False

    @classmethod
    def from_dict(cls, data: dict | None) -> "TranscribeOptions":
        data = data or {}
        mapping = {
            "model": "model", "device": "device", "computeType": "compute_type", "language": "language",
            "task": "task", "beamSize": "beam_size", "temperature": "temperature",
            "vadFilter": "vad_filter", "vadMinSilenceMs": "vad_min_silence_ms",
            "wordTimestamps": "word_timestamps", "conditionOnPreviousText": "condition_on_previous_text",
            "initialPrompt": "initial_prompt", "noSpeechThreshold": "no_speech_threshold",
            "compressionRatioThreshold": "compression_ratio_threshold", "cpuThreads": "cpu_threads",
            "diarize": "diarize",
        }
        kwargs: dict[str, Any] = {}
        for camel, snake in mapping.items():
            if camel in data and data[camel] is not None:
                kwargs[snake] = data[camel]
            elif snake in data and data[snake] is not None:
                kwargs[snake] = data[snake]
        if data.get("language") in ("", "auto"):
            kwargs["language"] = None
        return cls(**kwargs)


# --------------------------------------------------------------------------
# Environment and capability probing
# --------------------------------------------------------------------------


def _force_offline() -> None:
    settings = get_settings()
    os.environ["HF_HUB_OFFLINE"] = "1"
    os.environ["TRANSFORMERS_OFFLINE"] = "1"
    os.environ.setdefault("HF_HOME", str(settings.models_dir))
    os.environ.setdefault("HUGGINGFACE_HUB_CACHE", str(settings.models_dir / "hub"))


def backend_status() -> dict:
    """Is Faster-Whisper importable, and what hardware can it use?"""
    _force_offline()
    installed, version, error = False, None, None
    try:
        import faster_whisper  # type: ignore

        installed = True
        version = getattr(faster_whisper, "__version__", None)
    except Exception as exc:  # pragma: no cover - depends on the install
        error = str(exc)
    return {
        "installed": installed,
        "version": version,
        "error": error,
        "devices": available_devices(),
        "models": list_models(),
    }


_device_cache: list[dict] | None = None


def available_devices(refresh: bool = False) -> list[dict]:
    """CPU always; CUDA when CTranslate2 can see a device."""
    global _device_cache
    if _device_cache is not None and not refresh:
        return _device_cache
    devices = [{"id": "cpu", "label": "CPU", "available": True, "computeTypes": COMPUTE_TYPES["cpu"]}]
    cuda_count = 0
    try:
        import ctranslate2  # type: ignore

        cuda_count = ctranslate2.get_cuda_device_count()
    except Exception:
        cuda_count = 0
    devices.append(
        {
            "id": "cuda",
            "label": f"NVIDIA GPU ({cuda_count} device{'s' if cuda_count != 1 else ''})" if cuda_count else "NVIDIA GPU",
            "available": cuda_count > 0,
            "deviceCount": cuda_count,
            "computeTypes": COMPUTE_TYPES["cuda"],
            "note": None if cuda_count else "No CUDA device visible. Install the NVIDIA driver, cuBLAS and cuDNN to use one.",
        }
    )
    _device_cache = devices
    return devices


def resolve_device(requested: str = "auto") -> str:
    if requested in ("cpu", "cuda"):
        return requested
    cuda = next((d for d in available_devices() if d["id"] == "cuda"), None)
    return "cuda" if cuda and cuda["available"] else "cpu"


def resolve_compute_type(device: str, requested: str = "auto") -> str:
    if requested and requested != "auto":
        return requested
    # int8 roughly halves CPU time at a small accuracy cost; float16 is the
    # natural fit on any CUDA card new enough to run this at all.
    return "float16" if device == "cuda" else "int8"


# --------------------------------------------------------------------------
# Model discovery
# --------------------------------------------------------------------------


def model_dir(name: str) -> Path:
    return get_settings().models_dir / f"faster-whisper-{name}"


def _hub_snapshot(name: str) -> Path | None:
    """Find a model inside a local Hugging Face cache, if one was populated."""
    entry = CATALOG_BY_NAME.get(name)
    if not entry:
        return None
    cache = get_settings().models_dir / "hub"
    folder = "models--" + entry["repo"].replace("/", "--")
    snapshots = cache / folder / "snapshots"
    if not snapshots.exists():
        return None
    for candidate in sorted(snapshots.iterdir(), reverse=True):
        if (candidate / "model.bin").exists():
            return candidate
    return None


def resolve_model_path(name: str) -> Path | None:
    """Where this model lives locally, or None if it is not installed.

    A valid CTranslate2 model directory always contains ``model.bin`` beside a
    tokenizer; checking for the file rather than the folder stops a half-copied
    download from being reported as ready.
    """
    direct = model_dir(name)
    if (direct / "model.bin").exists():
        return direct
    return _hub_snapshot(name)


def list_models() -> list[dict]:
    rows = {row["name"]: row for row in db.query("SELECT * FROM asr_models")}
    out = []
    for entry in MODEL_CATALOG:
        path = resolve_model_path(entry["name"])
        installed = path is not None
        size = None
        if installed:
            try:
                size = sum(f.stat().st_size for f in path.rglob("*") if f.is_file())
            except OSError:
                size = None
        db.execute(
            "INSERT INTO asr_models(name, path, bytes, installed, checked_at) VALUES (?,?,?,?,?)"
            " ON CONFLICT(name) DO UPDATE SET path=excluded.path, bytes=excluded.bytes,"
            " installed=excluded.installed, checked_at=excluded.checked_at",
            (entry["name"], str(path) if path else None, size, 1 if installed else 0, now_iso()),
        )
        out.append({**entry, "installed": installed, "path": str(path) if path else None, "bytes": size})
    return out


def recommend_model(ram_gb: float | None = None, has_cuda: bool | None = None, vram_gb: float | None = None) -> str:
    """Pick the largest model the machine can run without swapping."""
    installed = {entry["name"] for entry in list_models() if entry["installed"]}
    if has_cuda is None:
        has_cuda = any(d["id"] == "cuda" and d["available"] for d in available_devices())
    budget = (vram_gb or 0) if has_cuda else (ram_gb or 8.0)
    order = ["large-v3", "medium", "small", "base", "tiny"]
    for name in order:
        entry = CATALOG_BY_NAME[name]
        need = entry["vramGb"] if has_cuda else entry["ramGb"]
        if budget >= need and (not installed or name in installed):
            return name
    return "tiny"


# --------------------------------------------------------------------------
# Loading and running
# --------------------------------------------------------------------------

_models: dict[tuple[str, str, str], Any] = {}
_model_lock = threading.Lock()


def load_model(name: str, device: str = "auto", compute_type: str = "auto"):
    if name not in CATALOG_BY_NAME:
        raise AppError(f"Unknown model: {name}", code="unknown_model")
    _force_offline()
    try:
        from faster_whisper import WhisperModel  # type: ignore
    except Exception as exc:
        raise ModelMissing(
            "Faster-Whisper is not installed in the backend environment",
            code="whisper_not_installed",
            hint="Run `pip install faster-whisper` in the backend environment, or reinstall "
            "SubtitleForge — the Windows installer bundles it.",
            details={"error": str(exc)},
        ) from exc

    path = resolve_model_path(name)
    if path is None:
        entry = CATALOG_BY_NAME[name]
        raise ModelMissing(
            f"The {name} model is not installed",
            hint=f"Place the CTranslate2 conversion of {entry['repo']} in "
            f"{model_dir(name)} ({entry['diskMb']} MB). SubtitleForge never downloads models itself; "
            "copy them from another machine or fetch them once with the bundled fetch-models script.",
            details={"model": name, "expectedPath": str(model_dir(name)), "repo": entry["repo"]},
        )

    device = resolve_device(device)
    compute = resolve_compute_type(device, compute_type)
    key = (name, device, compute)
    with _model_lock:
        if key in _models:
            return _models[key]
        settings = get_settings()
        try:
            model = WhisperModel(
                str(path),
                device=device,
                compute_type=compute,
                cpu_threads=max(0, int(getattr(settings, 'cpu_threads', 0) or 0)),
                local_files_only=True,
                download_root=str(settings.models_dir),
            )
        except Exception as exc:
            raise ModelMissing(
                f"Could not load the {name} model on {device}",
                code="model_load_failed",
                hint="A CUDA load failure usually means cuBLAS or cuDNN is missing; switching the "
                "device to CPU in Settings will work while you install them.",
                details={"error": str(exc), "device": device, "computeType": compute},
            ) from exc
        # One model at a time: large-v3 is 3 GB, and holding two would push a
        # 16 GB machine into swap during a render.
        _models.clear()
        _models[key] = model
        return model


def unload_models() -> None:
    with _model_lock:
        _models.clear()


@dataclass(slots=True)
class TranscriptResult:
    language: str | None
    language_probability: float | None
    duration_ms: int
    segments: list[dict] = field(default_factory=list)
    words: list[Word] = field(default_factory=list)
    model: str = ""
    device: str = ""

    def to_dict(self) -> dict:
        return {
            "language": self.language,
            "languageProbability": self.language_probability,
            "durationMs": self.duration_ms,
            "segments": self.segments,
            "wordCount": len(self.words),
            "model": self.model,
            "device": self.device,
        }


HALLUCINATION_PATTERNS = [
    re.compile(r"^\s*(thanks for watching|thank you for watching|subscribe to my channel)[.!]?\s*$", re.I),
    re.compile(r"^\s*\[?\s*(music|applause|silence|inaudible|blank_audio)\s*\]?\s*$", re.I),
    re.compile(r"^\s*(subtitles by|transcription by|amara\.org)", re.I),
]


def _is_hallucination(text: str, duration_ms: int) -> bool:
    """Whisper invents stock phrases over silence. Drop the known ones.

    The test is deliberately narrow: a real "thanks for watching" at the end of
    a video lasts about as long as it takes to say, while the hallucinated one
    sits on a two-second gap.
    """
    stripped = text.strip()
    if not stripped:
        return True
    if duration_ms < 1200 and any(pattern.match(stripped) for pattern in HALLUCINATION_PATTERNS):
        return True
    if len(stripped) > 12 and len(set(stripped.split())) == 1:
        return True
    return False


def transcribe(
    audio_path: str | Path,
    options: TranscribeOptions | None = None,
    *,
    progress=None,
    should_cancel=None,
    duration_ms: int | None = None,
) -> TranscriptResult:
    """Run recognition over an audio file.

    Progress comes from each segment's end timestamp against the known
    duration, which is honest for long files: Whisper decodes a 30 second
    window at a time and the reported position really is how far it has read.
    """
    opts = options or TranscribeOptions()
    model = load_model(opts.model, opts.device, opts.compute_type)
    device = resolve_device(opts.device)

    vad_parameters = {"min_silence_duration_ms": opts.vad_min_silence_ms} if opts.vad_filter else None
    segments_iter, info = model.transcribe(
        str(audio_path),
        language=opts.language,
        task=opts.task,
        beam_size=opts.beam_size,
        temperature=opts.temperature,
        vad_filter=opts.vad_filter,
        vad_parameters=vad_parameters,
        word_timestamps=opts.word_timestamps,
        condition_on_previous_text=opts.condition_on_previous_text,
        initial_prompt=opts.initial_prompt,
        no_speech_threshold=opts.no_speech_threshold,
        compression_ratio_threshold=opts.compression_ratio_threshold,
    )

    total_ms = duration_ms or int((getattr(info, "duration", 0) or 0) * 1000) or 1
    segments: list[dict] = []
    words: list[Word] = []
    for segment in segments_iter:
        if should_cancel and should_cancel():
            from ..core.errors import JobCancelled

            raise JobCancelled("Transcription cancelled")
        start_ms = int(segment.start * 1000)
        end_ms = int(segment.end * 1000)
        text = (segment.text or "").strip()
        if _is_hallucination(text, end_ms - start_ms):
            continue
        confidence = None
        if getattr(segment, "avg_logprob", None) is not None:
            # exp(avg_logprob) is a usable 0-1 confidence for display.
            confidence = round(min(1.0, max(0.0, 2.718281828 ** segment.avg_logprob)), 4)
        segments.append(
            {
                "startMs": start_ms,
                "endMs": end_ms,
                "text": text,
                "confidence": confidence,
                "noSpeechProb": getattr(segment, "no_speech_prob", None),
            }
        )
        for word in getattr(segment, "words", None) or []:
            token = (word.word or "").strip()
            if not token:
                continue
            words.append(
                Word(
                    start_ms=int(word.start * 1000),
                    end_ms=max(int(word.end * 1000), int(word.start * 1000) + 10),
                    text=token,
                    probability=round(float(word.probability), 4) if word.probability is not None else None,
                )
            )
        if progress:
            progress(min(0.99, end_ms / total_ms), "transcribing")
    if progress:
        progress(1.0, "transcribed")
    return TranscriptResult(
        language=getattr(info, "language", opts.language),
        language_probability=round(float(getattr(info, "language_probability", 0) or 0), 4) or None,
        duration_ms=total_ms,
        segments=segments,
        words=words,
        model=opts.model,
        device=device,
    )
