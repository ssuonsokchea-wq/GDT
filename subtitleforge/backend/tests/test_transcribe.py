"""The Faster-Whisper wrapper.

Model weights are large and the application never downloads them, so these
tests exercise the wrapper around the model: catalogue data, device and
compute-type resolution, the offline guard, and the segment-to-word conversion
that feeds the segmenter. A stub stands in for the model itself.
"""

from __future__ import annotations

import sys
import types

import pytest

from subtitleforge.core.errors import ModelMissing
from subtitleforge.services import transcribe as asr


class FakeWord:
    def __init__(self, start, end, word, probability=0.9):
        self.start, self.end, self.word, self.probability = start, end, word, probability


class FakeSegment:
    def __init__(self, start, end, text, words=None, avg_logprob=-0.2, no_speech_prob=0.01):
        self.start, self.end, self.text = start, end, text
        self.words = words
        self.avg_logprob, self.no_speech_prob = avg_logprob, no_speech_prob


class FakeInfo:
    language = "en"
    language_probability = 0.98
    duration = 6.0


class FakeModel:
    """Stands in for WhisperModel: records how it was called, returns fixtures."""

    def __init__(self, segments):
        self._segments = segments
        self.calls: list[dict] = []

    def transcribe(self, path, **kwargs):
        self.calls.append({"path": path, **kwargs})
        return iter(self._segments), FakeInfo()


@pytest.fixture
def stub_model(monkeypatch):
    def install(segments):
        model = FakeModel(segments)
        monkeypatch.setattr(asr, "load_model", lambda *a, **k: model)
        monkeypatch.setattr(asr, "resolve_device", lambda requested="auto": "cpu")
        return model

    return install


class TestCatalogue:
    def test_the_five_specified_models_are_offered(self):
        assert [entry["name"] for entry in asr.MODEL_CATALOG] == ["tiny", "base", "small", "medium", "large-v3"]

    def test_each_entry_states_what_hardware_it_needs(self):
        for entry in asr.MODEL_CATALOG:
            assert entry["diskMb"] > 0 and entry["ramGb"] > 0 and entry["vramGb"] > 0
            assert entry["recommendedFor"]

    def test_bigger_models_are_slower_and_larger(self):
        speeds = [entry["relativeSpeed"] for entry in asr.MODEL_CATALOG]
        sizes = [entry["diskMb"] for entry in asr.MODEL_CATALOG]
        assert speeds == sorted(speeds, reverse=True)
        assert sizes == sorted(sizes)

    def test_recommendation_fits_the_machine(self, settings):
        assert asr.recommend_model(ram_gb=2.0, has_cuda=False) in ("tiny", "base")
        assert asr.recommend_model(ram_gb=32.0, has_cuda=False) == "large-v3"
        assert asr.recommend_model(has_cuda=True, vram_gb=6.0) == "medium"


class TestDeviceResolution:
    def test_cpu_is_always_available(self):
        devices = {device["id"]: device for device in asr.available_devices(refresh=True)}
        assert devices["cpu"]["available"] is True

    def test_an_unavailable_gpu_explains_itself(self):
        cuda = next(device for device in asr.available_devices(refresh=True) if device["id"] == "cuda")
        if not cuda["available"]:
            assert cuda["note"]

    def test_explicit_requests_are_honoured(self):
        assert asr.resolve_device("cpu") == "cpu"

    def test_compute_type_defaults_per_device(self):
        assert asr.resolve_compute_type("cpu") == "int8"
        assert asr.resolve_compute_type("cuda") == "float16"
        assert asr.resolve_compute_type("cpu", "float32") == "float32"


class TestOfflineGuard:
    def test_a_missing_model_names_the_folder_to_put_it_in(self, settings, monkeypatch):
        # Pretend the library is installed so the error is about the weights.
        monkeypatch.setitem(sys.modules, "faster_whisper", types.SimpleNamespace(WhisperModel=object))
        with pytest.raises(ModelMissing) as caught:
            asr.load_model("small")
        assert "small" in str(caught.value)
        assert str(asr.model_dir("small")) in (caught.value.hint or "")

    def test_an_unknown_model_name_is_refused(self, settings):
        with pytest.raises(Exception):
            asr.load_model("enormous")

    def test_offline_environment_variables_are_set(self, settings):
        import os

        asr._force_offline()
        assert os.environ["HF_HUB_OFFLINE"] == "1"
        assert os.environ["TRANSFORMERS_OFFLINE"] == "1"

    def test_a_half_copied_model_is_not_reported_as_installed(self, settings):
        folder = asr.model_dir("base")
        folder.mkdir(parents=True)
        (folder / "tokenizer.json").write_text("{}", encoding="utf-8")
        assert asr.resolve_model_path("base") is None     # no model.bin yet
        (folder / "model.bin").write_bytes(b"\x00")
        assert asr.resolve_model_path("base") == folder

    def test_list_models_records_what_is_installed(self, settings):
        folder = asr.model_dir("tiny")
        folder.mkdir(parents=True)
        (folder / "model.bin").write_bytes(b"\x00" * 64)
        entries = {entry["name"]: entry for entry in asr.list_models()}
        assert entries["tiny"]["installed"] is True and entries["tiny"]["bytes"] == 64
        assert entries["medium"]["installed"] is False


class TestTranscription:
    def test_words_and_segments_are_converted_to_milliseconds(self, settings, stub_model):
        stub_model([
            FakeSegment(0.5, 2.0, " Hello there", [FakeWord(0.5, 0.9, " Hello"), FakeWord(1.0, 2.0, " there")]),
        ])
        result = asr.transcribe("audio.wav", asr.TranscribeOptions(model="tiny"))
        assert result.segments[0]["startMs"] == 500 and result.segments[0]["endMs"] == 2000
        assert [word.text for word in result.words] == ["Hello", "there"]
        assert result.words[0].start_ms == 500

    def test_text_is_stripped_and_confidence_derived(self, settings, stub_model):
        stub_model([FakeSegment(0, 1, "  Padded  ", avg_logprob=-0.1)])
        result = asr.transcribe("audio.wav")
        assert result.segments[0]["text"] == "Padded"
        assert 0 < result.segments[0]["confidence"] <= 1

    def test_language_detection_is_reported(self, settings, stub_model):
        stub_model([FakeSegment(0, 1, "Hello")])
        result = asr.transcribe("audio.wav")
        assert result.language == "en" and result.language_probability == 0.98

    def test_progress_is_reported_against_the_duration(self, settings, stub_model):
        stub_model([FakeSegment(0, 3, "First"), FakeSegment(3, 6, "Second")])
        seen: list[float] = []
        asr.transcribe("audio.wav", duration_ms=6000, progress=lambda frac, stage: seen.append(frac))
        assert seen and seen[-1] == 1.0
        assert seen == sorted(seen)

    def test_cancellation_stops_mid_stream(self, settings, stub_model):
        stub_model([FakeSegment(i, i + 1, f"Line {i}") for i in range(10)])
        from subtitleforge.core.errors import JobCancelled

        with pytest.raises(JobCancelled):
            asr.transcribe("audio.wav", should_cancel=lambda: True)

    def test_stock_hallucinations_over_silence_are_dropped(self, settings, stub_model):
        stub_model([
            FakeSegment(0.0, 0.4, " Thanks for watching!"),      # 400 ms: invented
            FakeSegment(1.0, 3.5, " Thanks for watching!"),      # 2.5 s: really said
            FakeSegment(4.0, 4.5, " [Music]"),
            FakeSegment(5.0, 6.0, " Real content here"),
        ])
        texts = [segment["text"] for segment in asr.transcribe("audio.wav").segments]
        assert texts == ["Thanks for watching!", "Real content here"]

    def test_a_repeated_word_loop_is_dropped(self, settings, stub_model):
        stub_model([FakeSegment(0, 5, " yeah yeah yeah yeah yeah yeah")])
        assert asr.transcribe("audio.wav").segments == []

    def test_options_reach_the_model(self, settings, stub_model):
        model = stub_model([FakeSegment(0, 1, "Hi")])
        options = asr.TranscribeOptions(language=None, beam_size=1, vad_filter=True, vad_min_silence_ms=700)
        asr.transcribe("audio.wav", options)
        call = model.calls[0]
        assert call["language"] is None and call["beam_size"] == 1
        assert call["vad_filter"] is True
        assert call["vad_parameters"] == {"min_silence_duration_ms": 700}

    def test_an_initial_prompt_is_passed_through(self, settings, stub_model):
        model = stub_model([FakeSegment(0, 1, "Hi")])
        asr.transcribe("audio.wav", asr.TranscribeOptions(initial_prompt="SubtitleForge, libass"))
        assert model.calls[0]["initial_prompt"] == "SubtitleForge, libass"

    def test_segments_without_word_timings_still_produce_a_result(self, settings, stub_model):
        stub_model([FakeSegment(0, 2, "No word stamps", words=None)])
        result = asr.transcribe("audio.wav")
        assert result.segments and result.words == []

    def test_options_parse_from_the_renderer_payload(self):
        options = asr.TranscribeOptions.from_dict(
            {"model": "medium", "device": "cuda", "language": "auto", "beamSize": 3, "vadFilter": False}
        )
        assert options.model == "medium" and options.device == "cuda"
        assert options.language is None and options.beam_size == 3 and options.vad_filter is False


class TestBackendStatus:
    def test_status_is_reported_without_raising(self, settings):
        status = asr.backend_status()
        assert set(status) >= {"installed", "devices", "models"}
