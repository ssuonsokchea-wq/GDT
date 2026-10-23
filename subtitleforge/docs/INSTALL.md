# Installing and running from source

## What you need

| | Minimum | Comfortable |
| --- | --- | --- |
| OS | Windows 10 (1909), macOS 12, Ubuntu 22.04 | Windows 11, macOS 14, Ubuntu 24.04 |
| CPU | 4 cores | 8 cores |
| RAM | 8 GB | 16 GB |
| Disk | 2 GB, plus 75 MB–3 GB per speech model | 20 GB |
| GPU | none required | NVIDIA with 6 GB VRAM and current drivers |
| Node | 20 | 22 |
| Python | 3.10 | 3.11 or 3.12 |
| FFmpeg | 6.0 | 7.x |

A GPU changes transcription from minutes to seconds and rendering from slow to
quick. Nothing requires one.

## The short version

```bash
git clone <this repository>
cd subtitleforge

npm install                                    # the interface

python3 -m venv backend/.venv                  # the engine
source backend/.venv/bin/activate              # Windows: backend\.venv\Scripts\activate
pip install -r backend/requirements-dev.txt

node scripts/fetch-models.mjs small            # 484 MB, once, with a connection

npm run dev                                    # Vite and Electron together
```

The application opens, starts the backend itself, and reports what it found.

## Step by step

### 1. FFmpeg

Everything that touches a video needs it. SubtitleForge looks for a bundled
copy first, then a path set in Settings → Tools, then the system `PATH`.

**Windows** — `winget install Gyan.FFmpeg`, or download a build from
<https://www.gyan.dev/ffmpeg/builds/> and add its `bin` to `PATH`. For a
packaged release, read the licensing note in
[PACKAGING_WINDOWS.md](PACKAGING_WINDOWS.md) before choosing a build.

**macOS** — `brew install ffmpeg`.

**Debian or Ubuntu** — `sudo apt install ffmpeg`.

Check it: `ffmpeg -version` and `ffprobe -version`.

### 2. The backend environment

A virtual environment, so the engine's dependencies cannot collide with
anything else on the machine.

```bash
python3 -m venv backend/.venv
source backend/.venv/bin/activate
pip install -r backend/requirements-dev.txt
```

That installs FastAPI, uvicorn, Faster-Whisper, CTranslate2, NumPy and the test
tools. On a machine with an NVIDIA GPU, add cuBLAS and cuDNN for GPU inference:

```bash
pip install nvidia-cublas-cu12 nvidia-cudnn-cu12
```

Without them the backend runs on CPU and says so in Settings → Hardware.

Point Electron at this interpreter by exporting `SF_PYTHON`:

```bash
export SF_PYTHON="$PWD/backend/.venv/bin/python"     # Windows: ...\Scripts\python.exe
```

### 3. Speech models

**SubtitleForge never downloads a model.** It is the one thing an offline
application must not do behind its user's back, and on a metered connection a
silent 3 GB fetch is a real cost. So there is a separate command, which the
application never calls:

```bash
node scripts/fetch-models.mjs --list            # what is available, and where it goes
node scripts/fetch-models.mjs small             # 484 MB — start here
node scripts/fetch-models.mjs medium large-v3   # when you have the hardware
```

It needs `pip install huggingface_hub` and a connection, and writes into the
application's models directory:

| Platform | Models directory |
| --- | --- |
| Windows | `%APPDATA%\SubtitleForge\models` |
| macOS | `~/Library/Application Support/SubtitleForge/models` |
| Linux | `~/.local/share/SubtitleForge/models` |

One folder per model, named `faster-whisper-<size>`, each containing
`model.bin` and its tokenizer files. Nothing stops you copying that folder from
another machine — which is the point: fetch once, deploy to as many offline
machines as you like.

Settings → Models shows what the application can see, and an installed check
looks for `model.bin` rather than the folder, so a half-copied download is
never reported as ready.

### 4. Run it

```bash
npm run dev
```

Vite serves the renderer with hot reload; Electron compiles the main process and
opens the window; the main process spawns the backend and waits for its
handshake. The window reports the backend's state in the title bar, and Settings
→ Hardware shows exactly what was found.

To run the backend by itself — useful when working on the pipeline:

```bash
cd backend
python -m subtitleforge --port 8756 --token dev-token --log-level debug
# then http://127.0.0.1:8756/docs for the generated API page
```

## Tests

```bash
npm test                        # renderer units (vitest)
npm run test:backend            # 270 backend tests (pytest)
npm run typecheck               # renderer and main process
npm run lint
```

The FFmpeg integration tests build their own fixtures from FFmpeg's synthetic
sources, so the repository carries no media, and they skip rather than fail when
FFmpeg is absent.

## Which model should I use?

On a laptop without a discrete GPU, `small` is the honest default: close to
`medium`'s accuracy on clear speech at roughly three times the speed.

| Model | Disk | RAM | Accuracy | Use it for |
| --- | --- | --- | --- | --- |
| `tiny` | 75 MB | 1 GB | rough | Timing checks. Expect name and number errors |
| `base` | 145 MB | 1.5 GB | fair | Clean single-speaker audio on a slow machine |
| `small` | 484 MB | 2.5 GB | good | The everyday default |
| `medium` | 1.5 GB | 5 GB | very good | Accents, crosstalk, technical vocabulary |
| `large-v3` | 3.1 GB | 10 GB | best | Publication masters — only with a 10 GB GPU |

On a CPU, `large-v3` transcribes at roughly real time: an hour of video takes
about an hour. With a suitable GPU it takes a few minutes.

## Optional extras

Neither is installed by default, and the application detects both.

```bash
pip install deepmultilingualpunctuation     # better commas in long passages
pip install pyannote.audio                  # research-grade speaker diarization
```

`pyannote` also needs its pipeline weights at
`<models>/pyannote/config.yaml`; without them the application uses its built-in
estimate and labels it as one.

## When something is wrong

**"FFmpeg was not found"** — it is not on `PATH`, or the shell that launched
Electron did not inherit it. Set the path in Settings → Tools, or export
`SF_FFMPEG` and `SF_FFPROBE`.

**"The medium model is not installed"** — the message names the folder it
looked in. Check that `model.bin` is directly inside
`faster-whisper-medium`, not inside a nested folder from an archive.

**"Faster-Whisper is not installed in the backend environment"** — Electron is
using a different Python. Export `SF_PYTHON` with the full path to the
virtual environment's interpreter.

**A CUDA load failure** means cuBLAS or cuDNN is missing. Install the two
packages above, or switch the device to CPU in the generate dialog; the
application will keep working while you sort it out.

**"The subtitle engine is not responding"** — the backend exited. Open the logs
folder from Help; `backend.log` has the Python traceback and
`backend-launcher.log` has what the main process tried to run.

**A render fails on a hardware encoder** — it retries in software
automatically and says so in the result. If you would rather not wait for the
failure, turn off "use the GPU when available" in the export dialog.

## Where your work is kept

| | Windows | macOS | Linux |
| --- | --- | --- | --- |
| Projects database | `%APPDATA%\SubtitleForge\subtitleforge.db` | `~/Library/Application Support/SubtitleForge/` | `~/.local/share/SubtitleForge/` |
| Models | `…\SubtitleForge\models` | `…/SubtitleForge/models` | `…/SubtitleForge/models` |
| Cache | `…\SubtitleForge\cache` | `…/SubtitleForge/cache` | `…/SubtitleForge/cache` |
| Logs | `…\SubtitleForge\logs` | `…/Logs/SubtitleForge` | `…/SubtitleForge/logs` |

Your videos are never copied. A project stores the path to the file where you
put it, which is why moving a video needs Relink rather than a re-import. The
cache holds extracted audio, waveforms and poster frames — about 115 MB per
hour of video — and clearing it costs only the time to rebuild.
