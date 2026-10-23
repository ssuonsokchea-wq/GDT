# Dependencies, and why each one

A dependency in a desktop application is a promise to your users about
something you do not control. These are the ones worth making.

## The engine

**Faster-Whisper** (`faster-whisper`, MIT) over OpenAI's reference
implementation. It runs Whisper through CTranslate2: roughly four times faster
and a third of the memory, with word-level timestamps and a built-in voice
activity filter. Word timestamps are not a nicety here — they are what makes
split, merge and resegment accurate rather than interpolated. The alternative,
`whisper.cpp`, is excellent and has no Python binding worth maintaining; if
the backend ever needs to be C++, that is the path.

**CTranslate2** (`ctranslate2`, MIT) is Faster-Whisper's inference engine,
listed explicitly because its CUDA requirements are the single most common
source of "it works on my machine": cuBLAS and cuDNN must be present for GPU
inference, and when they are not the backend says so and offers CPU.

**FFmpeg** (LGPL/GPL depending on build) for everything that touches a video
container: probing, audio extraction, waveform decoding, poster frames, and the
burn-in encode. There is no second option, and pretending otherwise would be
dishonest — every tool in this category is FFmpeg with a window on it. What
differs is how well the window handles FFmpeg's failures.

**libass**, through FFmpeg's `subtitles` filter, renders the captions. It is
what MPV and VLC use, which means a burned caption looks like the caption a
player would have drawn. Choosing it is also what lets the live preview be
honest: the preview's CSS and the render's ASS come from one style model.

**NumPy** (BSD) for the built-in speaker estimate — FFT, clustering, nothing
exotic. It arrives with Faster-Whisper anyway.

## The backend service

**FastAPI** (MIT) and **uvicorn** (BSD). The backend is a local sidecar, so the
case for FastAPI is not throughput: it is that pydantic validation and the
generated OpenAPI page make the contract with the renderer inspectable while
developing, and that `TestClient` makes the whole HTTP surface testable in
process. The whole API is about 1,400 lines.

**pydantic** (MIT) for request shapes. Coercion at the boundary means a service
function never has to ask whether `startMs` arrived as a string.

**SQLite** (public domain), via the Python standard library. No ORM. The schema
is 250 lines of SQL that a contributor can read in five minutes, the queries
are the ones in `services/`, and there is no migration framework to learn. For
a single-writer local database, an ORM adds a layer and removes clarity.

**PyInstaller** (GPL with an exception for frozen output) to make the Windows
installer independent of a system Python.

### Optional, and never installed silently

**`deepmultilingualpunctuation`** improves comma and full-stop placement in long
unpunctuated passages. The rule engine runs with or without it.

**`pyannote.audio`** gives research-grade diarization. It needs gated weights
and about 2 GB, which is why it is opt-in; the application detects it and
switches automatically.

## The interface

**Electron 33** (MIT). The question that matters is Electron versus Tauri. Tauri
would produce a 10 MB binary instead of 120 MB — immaterial next to a 484 MB
speech model — and would give us a system webview whose video element behaves
differently on every Windows build. For an application whose centre is a video
element with a styled overlay, one known Chromium is worth the disk. Revisit if
the installer ever needs to be small.

**React 18** (MIT) and **TypeScript 5.7** (Apache 2.0). The editor is a few
thousand cues with a timeline, a virtualised list and a live preview reading one
clock; this is the problem React is for, and the types are what make a hundred
fields of style model survivable.

**Zustand** (MIT) over Redux or Context. Four small stores, selector-based
subscriptions, no provider tree, no action boilerplate. It matters here because
the editor store changes on every keystroke and the app store changes a few
times per launch — keeping them separate is what stops a toast from
re-rendering the timeline, and Zustand makes that split cost nothing.

**Tailwind CSS 3.4** (MIT). A design system of tokens in one file, with the
component classes that recur (`panel`, `field-label`, `cue-block`) extracted
into `@layer components`. The alternative in a dark application this dense is
either a component library whose opinions fight yours, or a thousand lines of
hand-written CSS.

**Vite 6** (MIT) for the renderer build. Instant HMR while building a UI this
large is the difference between a day and a week.

**lucide-react** (ISC) for icons: one consistent 24-pixel grid, tree-shaken,
and no icon font to load offline.

**clsx** (MIT) for conditional classes. Four hundred bytes.

### Deliberately absent

No HTTP client library — `fetch` with a typed wrapper is 200 lines and has no
surprises. No date library — three formatting functions, tested. No virtualised
list library — the cue list windows by a fixed row estimate in twenty lines. No
drag-and-drop library — the timeline needs pointer capture and arithmetic, not
a framework. No charting, no animation library, no component kit.

Each absence is a dependency we do not have to audit, update, or explain when
it breaks.

## Development

**vitest** for renderer units — same transform pipeline as the build, so a test
and the app see the same module. **pytest** for the backend, including the
FFmpeg integration tests that build their own fixtures with FFmpeg's synthetic
sources, so the repository carries no media. **ruff** for Python linting and
import order. **ESLint** with the TypeScript plugin. **electron-builder** for
NSIS, DMG and AppImage output.

## Fonts

**Inter** and **JetBrains Mono**, both SIL Open Font License 1.1, bundled
rather than fetched — a web font in an offline application has nothing to fetch
from. They are not in version control; `assets/fonts/README.md` says where to
get them and what happens without them.

## Licensing in one paragraph

Everything above is MIT, BSD, Apache 2.0, ISC, OFL or public domain, except
FFmpeg and PyInstaller. PyInstaller's GPL carries an explicit exception for the
executables it produces, so a frozen backend may be shipped under any licence.
FFmpeg is the question that decides the product's own licence: an LGPL build may
be shipped with a commercial, closed-source application provided it is
dynamically linked and the licence notice is included, while a GPL build —
which is what most prebuilt Windows binaries are, because they include x264 —
would make this application GPL. **For a commercial release, build FFmpeg from
source under LGPL 2.1 with `--enable-gpl` omitted, or license x264
separately.** This is not a detail to settle after launch; see
[PACKAGING_WINDOWS.md](PACKAGING_WINDOWS.md).

Whisper's model weights are MIT, which is why they can be redistributed at all.
