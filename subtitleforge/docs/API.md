# API and communication design

Three channels, each chosen for the shape of its traffic.

| Channel | Carries | Why this and not something else |
| --- | --- | --- |
| **IPC** (preload → main) | Dialogs, guarded file reads, shell actions, the backend handle | Only the main process may touch the filesystem; the surface is named functions, never `ipcRenderer` |
| **HTTP** (renderer → backend) | Commands: create, read, update, start a job | Requests with replies, and an OpenAPI page that makes the contract inspectable while developing |
| **SSE** (backend → renderer) | Progress and job state for every job | One-way, many-reader, survives a reload, and reconnects with replay |

All HTTP is `http://127.0.0.1:<assigned-port>/api/v1` with `X-SF-Token` on
every request. The port is assigned by the OS and the token generated per
launch; both reach the renderer through `window.sf.backend.handle()`.

## Commands

### System

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/health` | Liveness |
| `GET` | `/capabilities` | Everything the UI needs to decide what to offer: platform, paths, free disk, FFmpeg, encoders, models, devices, diarization backends, fonts |
| `GET` | `/encoders?verify=true` | Encoder catalogue; `verify` encodes two black frames through each hardware encoder, which is the only honest hardware test |
| `GET` | `/models` | Whisper models with disk, RAM and VRAM costs, and whether each is installed |
| `GET` | `/fonts?refresh=` | Font families libass can resolve |
| `GET`/`PUT` | `/settings`, `/settings/{key}` | Application preferences |
| `GET` | `/media/supported` | Container, audio and subtitle formats |

`/capabilities` is one call rather than five because the alternative is five
round trips during startup and a window that renders controls it then disables.

### Media

| Method | Path | Purpose |
| --- | --- | --- |
| `POST` | `/media/probe` | Properties without importing — what the import dialog shows before writing anything |
| `POST` | `/media/import` | Probe and record against a project |
| `GET` | `/media/{id}` | The stored record |
| `GET` | `/media/{id}/stream` | The preview source. Answers `Range` with 206, so the video element seeks |
| `POST` | `/media/{id}/audio` | Extract WAV, MP3, AAC, M4A or FLAC → job |
| `POST`/`GET` | `/media/{id}/waveform` | Build, then read, the peak pairs |
| `GET` | `/media/{id}/poster`, `/frame` | A JPEG frame |
| `DELETE` | `/media/{id}/cache` | Drop derived files; never the source |

The stream endpoint exists because the renderer cannot load a `file://` URL: in
development the page is served over HTTP, and in production a custom protocol
would have to reimplement range requests. Streaming over loopback costs nothing
measurable next to decoding 4K.

### Projects, styles, speakers

| Method | Path | Purpose |
| --- | --- | --- |
| `GET`/`POST` | `/projects` | List (archived optional), create |
| `GET`/`PATCH`/`DELETE` | `/projects/{id}` | Read, update, delete |
| `POST` | `/projects/{id}/open` | Read in full and stamp `last_opened_at` |
| `POST` | `/projects/{id}/duplicate` | Clone with every track and cue |
| `POST` | `/projects/{id}/relink` | Point at moved media, keeping all edits |
| `GET`/`POST` | `/projects/{id}/bundle`, `/bundle/save` | The portable `.sfproj` document |
| `POST` | `/projects/import`, `/projects/import/file` | Restore a bundle |
| `GET` | `/projects/{id}/speakers` | Speaker rows |
| `PATCH` | `/speakers/{id}` | Rename, recolour |
| `GET`/`POST`/`DELETE` | `/styles`, `/styles/{id}` | Presets and saved styles; presets are 409 on delete |
| `POST` | `/styles/preview` | One style model → CSS for the overlay **and** an ASS style line |
| `GET` | `/render-presets` | The five output presets |

`PATCH /projects/{id}` merges `settings` one level deep, so the style panel can
send `{"style": {"fontSize": 72}}` without resending the rest.

`POST /styles/preview` is the endpoint that keeps the preview honest: both
translations of the style come from one function, so the overlay cannot drift
from the burn.

### Tracks and cues

| Method | Path | Purpose |
| --- | --- | --- |
| `POST` | `/tracks` | Create an empty track |
| `GET`/`PATCH`/`DELETE` | `/tracks/{id}` | Read (optionally with cues and words), rename, delete |
| `GET`/`PUT` | `/tracks/{id}/cues` | Read; replace the whole track in one transaction |
| `PATCH`/`DELETE` | `/tracks/{id}/cues/{cueId}` | One cue; a timing change resolves the overlap it creates |
| `POST` | `/tracks/{id}/cues/{cueId}/split` | By `atMs` or `atChar`, using word timings |
| `POST` | `/tracks/{id}/cues/merge` | Two or more cues |
| `POST` | `/tracks/{id}/shift` | Offset timings from a point |
| `POST` | `/tracks/{id}/resegment` | Re-cut to new line limits, reusing word timings |
| `GET` | `/tracks/{id}/quality` | The QC report |
| `GET` | `/tracks/{id}/revisions` | The commit journal |
| `GET` | `/tracks/{id}/preview?format=` | The serialised track as text |

Replacing a whole track looks wasteful next to row updates. It is correct: a
track is at most a few thousand rows, the editor's operations touch most of them
anyway, and an all-or-nothing write means a crash mid-save can never leave two
cues claiming the same index.

### Jobs and pipelines

| Method | Path | Purpose |
| --- | --- | --- |
| `POST` | `/transcribe` | Video → saved subtitle track → job |
| `POST` | `/enhance` | Clean a track's text → job |
| `POST` | `/enhance/preview` | One string, synchronously — what the settings panel calls as options change |
| `POST` | `/subtitles/import` | SRT, VTT or ASS → a track |
| `POST` | `/export/subtitles` | Write a file → job |
| `POST` | `/render` | Burn in → job |
| `POST` | `/render/plan` | What the render will do, without doing it |
| `GET` | `/exports` | Delivery history, with an existence check |
| `GET` | `/jobs`, `/jobs/{id}`, `/jobs/{id}/events` | State and per-job log |
| `POST` | `/jobs/{id}/cancel` | Request cancellation |
| `GET`/`POST` | `/batches` | List, queue |
| `GET`/`POST` | `/batches/{id}`, `/batches/{id}/cancel` | Read, stop |

Anything that can take more than a second returns a `Job` immediately rather
than holding a request open. The renderer then watches the event stream.

## The event stream

`GET /events?since=<seq>` returns `text/event-stream`. Every event carries a
monotonic `seq`; the client remembers the highest it has seen and sends it on
reconnect, and the backend replays the last 200 events after that point.

```
id: 41
event: job.progress
data: {"seq":41,"type":"job.progress","jobId":"job_01HX…","progress":0.64,
       "stage":"transcribing","message":null}
```

| Event | Payload | What the UI does |
| --- | --- | --- |
| `hello` | — | Refetch the job list, to reconcile anything missed |
| `job.queued` / `job.started` | the full job | Add it to the queue panel |
| `job.progress` | `jobId`, `progress`, `stage`, `message` | Move one progress bar |
| `job.succeeded` | the full job | Run the follow-up: reload the track, the waveform, or show the output |
| `job.failed` | the full job, with `error_json` | A sticky toast carrying the code's hint |
| `job.cancelled` | the full job | Remove it quietly |
| `batch.finished` | `batchId`, `status` | Refresh the batch list |

A comment line every 15 seconds keeps a quiet stream from being treated as
dead. Progress is throttled to 0.2% steps in the backend, because a two-hour
render would otherwise emit thousands of events a second.

`EventSource` cannot set headers, so this route accepts the token as a query
parameter — as do the poster, frame and stream routes, for the same reason.

## Errors

Every failure a user can cause has a stable code, a human message, and a hint
naming the remedy.

```json
{
  "error": {
    "code": "model_missing",
    "message": "The medium model is not installed",
    "hint": "Place the CTranslate2 conversion of Systran/faster-whisper-medium in …",
    "details": { "model": "medium", "expectedPath": "…", "repo": "…" }
  }
}
```

| Status | Codes |
| --- | --- |
| 400 | `app_error`, `bad_audio_format`, `bad_subtitle_format`, `empty_track`, `empty_batch`, `merge_needs_two`, `bundle_version`, `no_media`, `no_track` |
| 401 | `unauthorised` |
| 404 | `not_found`, `file_not_found`, `not_built` |
| 409 | `conflict`, `preset_locked` |
| 415 | `unsupported_media`, `no_audio` |
| 499 | `job_cancelled` |
| 500 | `ffmpeg_failed`, `internal_error`, `disk_full` |
| 503 | `tool_missing`, `model_missing`, `whisper_not_installed`, `model_load_failed` |

Job failures carry the same object in `error_json`, so a failure discovered
through the event stream reads exactly like one returned from a request.

## The IPC surface

`window.sf`, from `electron/preload.cts`. Deliberately short — this is the
boundary where a compromised renderer would otherwise reach the filesystem.

```ts
sf.app.info() / quit()
sf.backend.handle() / status() / restart() / onStatus(fn)
sf.tools.locate(configured?) / onMissing(fn)
sf.dialog.openVideos() / openSubtitles() / openProject()
         / chooseFolder(title?) / saveAs(options) / confirm(options)
sf.files.stat(path) / readText(path) / writeText(path, text)
        / reveal(path) / open(path) / openLogs() / openModelsFolder()
sf.window.control('minimize'|'maximize'|'close'|'fullscreen') / state()
sf.menu.onCommand(fn)
```

`readText` refuses any extension outside subtitles, project files and plain
text, and refuses anything over 32 MB. Menu items send the same commands the
UI's own buttons call, so a shortcut and a click take one code path.

## The backend handshake

```
main process                              backend
     │  spawn, SF_TOKEN=…, SF_PORT=0        │
     ├─────────────────────────────────────►│
     │                                      │ bind an assigned port
     │  {"event":"ready","port":54931,…}    │
     │◄─────────────────────────────────────┤ one line of JSON on stdout
     │  (hand the handle to the renderer)   │
     │                                      │
     │  …work…                              │
     │                                      │
     │  SIGTERM on quit, SIGKILL after 5 s  │
     ├─────────────────────────────────────►│ finish the WAL checkpoint
```

The handshake rather than a guessed port is what avoids the race every
Electron-plus-sidecar application eventually hits. If the process exits while
the app is running, the supervisor restarts it with backoff and the renderer is
told; after five failures it reports a failure with a pointer to the log.
