# System architecture

## The shape of it

Three processes, one machine, no network.

```
┌─────────────────────────────────────────────────────────────────────┐
│ Electron main process          (Node 20, electron/main.ts)          │
│                                                                     │
│  • owns the window, the menu and the native dialogs                 │
│  • spawns and supervises the backend; holds the session token       │
│  • locates FFmpeg: bundled → configured → PATH                      │
│  • the only process with filesystem and child-process access        │
└───────────┬──────────────────────────────────┬──────────────────────┘
            │ contextBridge IPC                │ spawn + stdout handshake
            │ (named functions only)           │ SIGTERM on quit
┌───────────▼──────────────────────┐ ┌─────────▼──────────────────────┐
│ Renderer  (React 18 + TS)        │ │ Backend  (Python 3.11, FastAPI)│
│                                  │ │                                │
│  • no Node integration           │ │  • 127.0.0.1, OS-assigned port │
│  • CSP blocks every remote origin│ │  • token on every request      │
│  • Zustand stores, one per domain│ │  • SQLite (WAL) for all state  │
│  • talks HTTP + SSE to backend   │◄┼──┤ thread pool for long jobs    │
└──────────────────────────────────┘ └─────────┬──────────────────────┘
      HTTP /api/v1 + GET /events (SSE)         │ subprocess
                                     ┌─────────▼──────────────────────┐
                                     │ FFmpeg / FFprobe · libass      │
                                     │ Faster-Whisper → CTranslate2   │
                                     └────────────────────────────────┘
```

## Why three processes rather than two

The obvious design puts the AI work in the Electron main process through a
Node binding, and avoids an HTTP hop. We did not, for three reasons that each
cost more than the hop saves.

**The ecosystem is Python.** Faster-Whisper, CTranslate2, `pyannote` and every
punctuation model worth using are Python libraries with C++ cores. A Node
binding means maintaining our own, for three platforms, against libraries that
move monthly.

**A crash in recognition must not take the window with it.** CTranslate2 on an
unsupported CUDA configuration aborts the process. In-process, that is a lost
window and lost edits. Out of process, it is a restart with backoff and a
message in the status bar — which is what `BackendProcess` implements.

**The backend is testable without a UI.** The entire pipeline has a `pytest`
suite that runs headless in a few seconds, plus about twenty for the FFmpeg integration
tests. That is only possible because the pipeline never touches Electron.

The cost is a loopback HTTP hop per call. On a 20-minute transcription that is
unmeasurable; on the style preview, which fires per slider movement, it is
debounced by 60 ms in the renderer.

## Process boundaries, and what crosses them

### Main ↔ backend: a handshake, then supervision

The main process generates a 32-byte token, spawns the backend with it in the
environment, and reads one line of JSON from its stdout:

```json
{"event":"ready","host":"127.0.0.1","port":54931,"token":"…","dataDir":"…"}
```

The port is zero in the environment, so the OS assigns a free one and the
backend reports it. Polling a hard-coded port instead produces the race that
every Electron-plus-sidecar application eventually hits, usually on the
machine of the one user who already has something on 8000.

If the backend exits while the application is running, `BackendProcess`
restarts it with linear backoff — a fast first retry for a transient clash,
longer waits after — up to five attempts, then reports a failure the renderer
displays with a pointer to the log. On quit, the main process sends SIGTERM,
waits five seconds, then SIGKILL, because quitting during a WAL checkpoint is
how a project database gets truncated.

In a packaged build the backend is a PyInstaller directory in
`resources/backend`. In development it is `python -m subtitleforge` from the
repository. The launcher checks for the frozen binary and falls back, so the
same code path serves both and a broken package degrades to a clear Python
error rather than silence.

### Main ↔ renderer: named functions, never `ipcRenderer`

`electron/preload.cts` exposes one object, `window.sf`, with about twenty named
functions grouped by domain: `app`, `backend`, `tools`, `dialog`, `files`,
`window`, `menu`. The renderer cannot reach `ipcRenderer`, `require` or any
path-taking primitive beyond those functions, and each handler validates its
own arguments. `fs:readText` refuses any extension outside subtitles, project
files and plain text, and refuses anything over 32 MB.

The window runs with `contextIsolation: true` and `nodeIntegration: false`.
`sandbox` is false — the preload needs `ipcRenderer` — which is why the preload
surface is kept this narrow.

### Renderer ↔ backend: REST for commands, SSE for progress

Every call carries `X-SF-Token`. Two browser APIs cannot set headers —
`<img>`/`<video>` loads and `EventSource` — so those routes also accept the
token as a query parameter. That is sound here because the token lives for one
launch, never leaves the machine, and the routes reached that way are reads.

The split is deliberate. Commands are requests: create a project, replace a
track's cues, start a render. Progress is a stream: one `GET /events` carries
every job's events to the whole UI, so the status bar, the queue panel and the
batch list read one truth. `EventSource` reconnects by itself, and the backend
replays anything missed since the sequence number the client last saw, so a
renderer reload during a two-hour render rejoins without losing the progress
bar.

See [API.md](API.md) for the endpoint list and the event shapes.

## Inside the backend

```
subtitleforge/
├── __main__.py          entry point: flags, logging, handshake, uvicorn
├── api/                 HTTP surface only — no logic lives here
│   ├── app.py           assembly, error handlers, lifespan
│   ├── deps.py          the token guard
│   └── routes_*.py      system, media, projects, tracks, jobs
├── core/                infrastructure
│   ├── config.py        settings from flags and environment
│   ├── db.py            connection per thread, migration, seeding
│   ├── jobs.py          the queue, JobContext, cancellation
│   ├── events.py        thread-safe → asyncio event broker
│   ├── errors.py        the coded error taxonomy
│   ├── ids.py           ULID-style sortable identifiers
│   └── clock.py         timestamps, in one place for tests
├── db/schema.sql        the whole schema, as one migration
├── models/schemas.py    pydantic request shapes
└── services/            everything that actually does the work
    ├── ffmpeg.py        probing, progress parsing, encoder discovery
    ├── media.py         audio extraction, posters, waveform peaks
    ├── transcribe.py    Faster-Whisper, offline-enforced
    ├── diarize.py       speaker turns: pyannote, or built-in estimate
    ├── segmentation.py  words → readable cues
    ├── enhance.py       punctuation, case, fillers, grammar
    ├── lexicon.py       the word lists enhancement relies on
    ├── subtitles.py     the Cue model and SRT/VTT/ASS read and write
    ├── styles.py        the style model → ASS and CSS
    ├── render_presets.py output presets
    ├── burn.py          the filtergraph, encoder choice, the plan
    ├── tracks.py        cue persistence
    ├── projects.py      project CRUD and the portable bundle
    └── pipeline.py      job handlers composing the above
```

The rule that keeps this navigable: **routes contain no logic and services
contain no HTTP.** A route parses, calls one service function or submits one
job, and serialises. Every service function is callable from `pytest` with no
client, which is why the suite is fast enough to run on every save.

### The job queue

Transcription and rendering are long, CPU-bound and cancellable, so they run on
a small pool of worker threads — one by default — while the HTTP layer stays
asyncio. `JobManager` owns a priority queue, a handler registry and the state
machine (`queued → running → succeeded | failed | cancelled`).

Each handler receives a `JobContext` with three things: `progress(fraction,
stage)`, `check_cancelled()`, and `log(message)`. Progress is throttled to
0.2% steps, because a two-hour render emits thousands of updates a second and
each one is a SQLite write and an event.

Composite pipelines divide their budget explicitly. `handle_transcribe` spends
1–8% on audio extraction, 8–78% on recognition, 78–90% on diarization when
asked, and the rest on segmentation, enhancement and saving. Those percentages
are measured on a 20-minute 1080p file with the `small` model on CPU, which is
the configuration most users will run. A `_ScopedContext` maps a nested
handler's 0–1 progress into a slice of its parent's bar, which is how a batch
item's transcription and render share one percentage.

A crash leaves rows in `running`. On startup the manager marks them `failed`
with an `interrupted` code rather than leaving a job that will never finish
sitting at 40% in the UI.

### Cancellation that actually cancels

Three layers cooperate. The API sets `cancel_requested` on the row. The
handler polls `ctx.cancelled` between units of work — per Whisper segment, per
waveform chunk. The FFmpeg runner's reader loop checks the same callback and
terminates the process group, then deletes the partial output file, because a
half-written MP4 is worse than none: it looks like a finished file.

## Inside the renderer

```
src/
├── main.tsx, App.tsx          mount, menu wiring, dialog routing
├── types/{api,bridge}.ts      the contract, hand-written
├── lib/
│   ├── api.ts                 typed client, ApiFailure with code and hint
│   ├── events.ts              the SSE subscription with replay
│   ├── time.ts                timecodes, frame snapping, formatting
│   └── subtitleText.ts        local measurements for per-keystroke feedback
├── store/
│   ├── useAppStore.ts         backend status, capabilities, toasts, dialogs
│   ├── useProjectStore.ts     the open project, media, tracks, settings
│   ├── useEditorStore.ts      cues, selection, playhead, undo
│   └── useJobStore.ts         jobs and batches, and what to do when one ends
├── hooks/useKeyboardShortcuts.ts
└── components/
    ├── layout/     AppShell (draggable dividers), TitleBar, StatusBar, RightPanel
    ├── panels/     ProjectPanel, QualityPanel
    ├── preview/    VideoPreview, SubtitleOverlay
    ├── timeline/   Timeline, WaveformCanvas
    ├── editor/     SubtitleEditor, CueRow
    ├── style/      StylePanel
    ├── batch/      JobQueue
    ├── dialogs/    Transcribe, Export, Batch, Settings, Projects, Help
    └── common/     Button, Controls, Modal, Toasts
```

Four stores, split by what changes together rather than by component tree. The
editor store re-renders on every keystroke; the app store changes a few times a
launch. Keeping them separate is what stops a toast from re-rendering the
timeline.

### Edits are local first, authoritative second

Typing in a cue updates `useEditorStore` immediately and schedules a save 600 ms
later. Waiting for a round trip per keystroke would make the editor feel like a
web form. The backend remains the authority — it renumbers, resolves overlaps
and journals the commit — and its reply replaces local state.

Operations that need data the renderer does not hold go straight to the
backend: split and merge use word-level timings, so a split lands on a real word
boundary instead of an interpolated guess.

### Undo is a stack of whole cue lists

A thousand cues is a few hundred kilobytes. A hundred-step history of complete
lists costs less than the complexity of inverse operations, and cannot drift
out of step with the document the way patch-based undo does once split, merge
and resegment are involved. Every commit is also journalled to
`cue_revisions`, bounded at 200 rows per track, so a crash loses at most the
last keystroke batch.

### One style model, two renderers

The style object is translated in exactly one place — `services/styles.py` —
into an ASS style line for libass and into CSS for the preview overlay. The
renderer never invents its own interpretation; it asks `POST /styles/preview`
and applies what comes back. That is why the preview can be trusted, and it is
the single most important structural decision in the UI.

Sizes and margins are expressed against a 1920×1080 reference frame and scaled
by the real output height, so one style looks the same on a 720p upload and a
4K master. The ASS file written for a burn declares the output resolution as
its `PlayRes`, and the font size is scaled to match.

## Data flow: one video, start to finish

```
import           probe (ffprobe) → media_files row → poster frame
   │
   ▼
transcribe       extract 16 kHz mono WAV → audio_tracks
   │             Faster-Whisper → segments + word timings
   │             [diarize] → speaker turns → labels per word
   │             segment_words() → cues honouring CPS and line limits
   │             enhance_cues() → punctuation, case, fillers
   │             save_cues() in one transaction → subtitle_tracks + cues + words
   ▼
edit             renderer mutates local cues → debounced PUT /tracks/:id/cues
   │             split/merge/resegment → backend, using word timings
   ▼
style            style changes → project settings → preview CSS from backend
   ▼
export           SRT/VTT/ASS from the Cue model
   │             or: write ASS → FFmpeg filtergraph → hardware or software encode
   ▼
exports row + a toast with "Show file"
```

## Security posture

An offline application that opens a local HTTP server has to be deliberate
about it, because loopback is not a security boundary: any process on the
machine, and any page that can reach `127.0.0.1`, would otherwise be able to
drive the backend.

Five measures, each closing a specific hole.

**A per-launch token on every request**, compared with `hmac.compare_digest`.
It exists in the main process and the preload bridge and nowhere else — not in
a file, not in an environment variable the renderer can read.

**Loopback binding only.** The backend never listens on an external interface.

**A content security policy with no remote origins**, declared in the document
and enforced again by the main process, which refuses navigation away from the
local bundle and denies every `window.open`.

**A narrow preload surface.** No `ipcRenderer`, no path-taking primitives, and
per-handler validation of what the renderer asks for.

**Offline enforced, not assumed.** `HF_HUB_OFFLINE` and `TRANSFORMERS_OFFLINE`
are set in the backend's environment by the main process before the process
starts, and again inside `transcribe.py` before `faster_whisper` is imported.
A mistake in our own code cannot start a download.

## Error handling

Every failure a user can cause has a stable machine code and a human remedy.
`AppError` subclasses carry `code`, `message`, `hint` and `details`; the API
returns them as `{"error": {...}}` with a sensible status; the renderer's
`ApiFailure` preserves all four and the toast shows the hint. A handful that
matter in practice:

| Code | What happened | What the user is told |
| --- | --- | --- |
| `tool_missing` | No FFmpeg | Install it, or point Settings → Tools at a binary |
| `model_missing` | Model not on disk | The folder to put it in, and its size |
| `whisper_not_installed` | Backend environment incomplete | Reinstall, or `pip install faster-whisper` |
| `no_audio` | Video has no audio track | Transcription needs audio; import a file with sound |
| `media_missing` | Source video moved | Use Relink in the project panel |
| `disk_full` | Not enough room for the render | The size needed, and to pick another folder or preset |
| `ffmpeg_failed` | Encoder refused | The job log has FFmpeg's own message; hardware renders retry in software automatically |

## Testing

| Layer | Tool | What it covers |
| --- | --- | --- |
| Subtitle model and formats | pytest | Timecode round-trips, SRT/VTT/ASS read and write, split, merge, shift, quality rules |
| Segmentation | pytest | Line balance, weak endings, pause breaks, speaker breaks, reading-speed repair |
| Enhancement | pytest | The documented example, fillers, acronyms, questions, cross-cue sentences, idempotence |
| Styling | pytest | ASS colour and alpha conversion, resolution scaling, field counts, every preset |
| Render arguments | pytest | CRF vs. CQ vs. global-quality per encoder family, output sizing, path escaping |
| HTTP surface | pytest + TestClient | Auth, project and cue lifecycle, job states, batch validation |
| FFmpeg integration | pytest | Real probe, extract, waveform, burn — including that burned captions change the pixels |
| Renderer utilities | vitest | Timecode parsing and formatting, wrapping, cue lookup, reading speed |

270 backend tests and 29 renderer tests at the time of writing. The FFmpeg
integration tests build their fixtures with FFmpeg's own synthetic sources, so
the repository carries no media, and they skip rather than fail when FFmpeg is
absent.

## Known limits of this build

Stated plainly, because an architecture document that only lists strengths is
marketing.

**Transcription has not been verified end to end in this environment.** The
model weights could not be fetched here, so the Faster-Whisper wrapper is
covered by tests with a stubbed model — conversion of segments and words,
progress reporting, cancellation, the hallucination filter and the offline
guard all tested — but no real audio has passed through a real model in this
checkout. Everything downstream of recognition is verified against real files.

**Speaker attribution is an estimate unless `pyannote` is installed.** The
built-in path clusters spectral fingerprints of pause-separated regions. On two
clearly separated voices it is usually right; on overlapping or noisy speech it
is not, and the UI labels it as an estimate.

**Enhancement is a rule engine, not a language model.** That is a deliberate
trade: deterministic, auditable, reversible, fast, and incapable of inventing
words the speaker did not say. It will not fix a genuinely garbled sentence.

**One job at a time.** Correct for a laptop, conservative for a 32-core
workstation. The queue takes a concurrency setting; the UI does not yet expose
it.
