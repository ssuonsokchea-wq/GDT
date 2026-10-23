# SubtitleForge AI

Offline subtitle generation, editing, styling and burn-in for desktop. Speech
recognition runs locally through Faster-Whisper; captions are rendered by
libass through FFmpeg. No account, no upload, no network.

```bash
npm install
python3 -m venv backend/.venv && source backend/.venv/bin/activate
pip install -r backend/requirements-dev.txt
export SF_PYTHON="$PWD/backend/.venv/bin/python"
node scripts/fetch-models.mjs small     # 484 MB, once, with a connection
npm run dev
```

Full setup, including Windows and GPU notes: [docs/INSTALL.md](docs/INSTALL.md).

## What it does

Import an MP4, MOV, MKV, AVI or WEBM file; press one button; get accurate,
readable, styled captions you can correct, then export as a file or burn into a
copy of the video.

- **Transcription** with Faster-Whisper in five model sizes, each stating its
  disk, memory and speed cost, plus an estimate for the file in front of you.
- **Segmentation** that produces captions rather than a chopped transcript: two
  lines of about 42 characters, under 21 characters a second, broken at
  sentence and clause boundaries.
- **Enhancement** that restores punctuation and sentence case, removes fillers
  and stutters, and fixes the spellings that are wrong in every context — as a
  deterministic rule engine that reports every change and keeps the original.
- **An editor** with a waveform timeline, draggable cues, typed timecodes,
  split and merge that use real word timings, and a hundred steps of undo.
- **Styling** with Netflix, YouTube, TikTok, Documentary and Minimalist presets
  and full control of type, colour, outline, box, position and line limits. The
  live preview is drawn from the same style model the renderer hands to libass.
- **Burn-in** using NVENC, Quick Sync, AMF or VideoToolbox where available, with
  automatic software fallback and an explanation when a driver refuses.
- **Batch processing** across many files, one at a time, each becoming a project
  you can open and edit afterwards.
- **Projects** that save the video's path, every cue, the style and the export
  settings — plus a portable `.sfproj` file.

Export formats: SRT, WebVTT, ASS, and MP4 with the captions in the picture.

## How it is built

Three processes on one machine. An Electron main process owns the window and
supervises the engine; a React renderer with no Node access talks to it through
a narrow preload bridge; a Python backend does the work behind a loopback HTTP
API with a per-launch token, streaming progress over server-sent events.

```
electron/   main process: window, menu, dialogs, backend supervision
src/        renderer: React 18, TypeScript, Zustand, Tailwind
backend/    Python: FastAPI, SQLite, Faster-Whisper, FFmpeg, libass
docs/       the twelve documents below
scripts/    PyInstaller freeze; the one network-touching command
```

[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) explains why three processes and
what crosses each boundary.

## Documentation

| | |
| --- | --- |
| [PRD.md](docs/PRD.md) | What we are building, for whom, and what we refuse to build |
| [ARCHITECTURE.md](docs/ARCHITECTURE.md) | The three processes, the job queue, the security posture |
| [DATABASE.md](docs/DATABASE.md) | The SQLite schema, and why it is shaped that way |
| [API.md](docs/API.md) | Endpoints, the event stream, the error codes |
| [WIREFRAMES.md](docs/WIREFRAMES.md) | The interface, and the reasoning behind each region |
| [FOLDER_STRUCTURE.md](docs/FOLDER_STRUCTURE.md) | Where everything lives, and the rules that keep it there |
| [LIBRARIES.md](docs/LIBRARIES.md) | Every dependency, why it was chosen, and the licensing decision |
| [ROADMAP.md](docs/ROADMAP.md) | What is done, what is next, and in what order |
| [INSTALL.md](docs/INSTALL.md) | Running from source, models, troubleshooting |
| [PACKAGING_WINDOWS.md](docs/PACKAGING_WINDOWS.md) | Producing the installer, and verifying it on a clean machine |
| [PREMIUM.md](docs/PREMIUM.md) | What paid tiers would add, and what stays free |
| [COMMERCIALIZATION.md](docs/COMMERCIALIZATION.md) | Positioning, pricing, unit economics, risks |

## Tests

```bash
npm run test:backend    # 270 tests (pytest)
npm test                # 29 tests (vitest)
npm run typecheck       # renderer and main process
```

The FFmpeg integration tests build their fixtures from FFmpeg's own synthetic
sources — the repository carries no media — and verify real behaviour, including
that burned captions change the pixels where they are drawn. They skip rather
than fail when FFmpeg is absent.

## Honest limits of this build

**Real speech recognition has not been exercised in the environment this was
built in**, because the model weights could not be fetched there. The
Faster-Whisper wrapper is tested against a stubbed model — segment and word
conversion, progress, cancellation, the hallucination filter, the offline
guard — but no real audio has passed through a real model in this checkout.
Everything downstream of recognition is verified against real files. Verifying
transcription against a twenty-file corpus is the first task in
[ROADMAP.md](docs/ROADMAP.md).

**Speaker attribution is an estimate** unless `pyannote.audio` is installed.
The built-in path clusters spectral fingerprints of pause-separated regions: on
two clearly separated voices it is usually right, on overlapping or noisy
speech it is not, and the interface labels it as an estimate.

**Enhancement is a rule engine, not a language model.** Deterministic,
auditable, reversible, and incapable of inventing words the speaker did not
say. It will not repair a genuinely garbled sentence.

**The Windows installer configuration has not been run on Windows.** Every file
it needs is here; the build has not been executed on the target platform.

**One job runs at a time.** Correct for a laptop, conservative for a
workstation. The queue accepts a concurrency setting; the interface does not yet
expose it.

## Licensing

The application's own code and documentation are in this repository. Every
dependency is MIT, BSD, Apache 2.0, ISC, OFL or public domain, except FFmpeg
and PyInstaller.

PyInstaller's GPL carries an explicit exception for the executables it produces.
FFmpeg is the question that decides this product's own licence: **a GPL FFmpeg
build — which most prebuilt Windows binaries are, because they include x264 —
would make a distributed application GPL.** For a commercial release, build
FFmpeg from source under LGPL 2.1 or license x264 separately. The application
discovers encoders at runtime and does not care which build it finds, so this is
a packaging decision rather than a code change. See
[LIBRARIES.md](docs/LIBRARIES.md) and
[PACKAGING_WINDOWS.md](docs/PACKAGING_WINDOWS.md).

Whisper's model weights are MIT, which is what makes them redistributable at
all.
