# Folder structure

```
subtitleforge/
├── package.json                 scripts, dependencies, electron-builder entry
├── electron-builder.yml         packaging for Windows, macOS, Linux
├── tsconfig.json                renderer TypeScript (bundler resolution)
├── vite.config.ts               renderer build; relative base for file:// loading
├── vitest.config.ts             renderer unit tests, jsdom
├── tailwind.config.js           the design tokens live here
├── postcss.config.js
├── index.html                   the content security policy is declared here
│
├── electron/                    ── MAIN PROCESS (Node) ──
│   ├── main.ts                  window, lifecycle, navigation guards
│   ├── menu.ts                  native menu → one command channel
│   ├── preload.cts              the contextBridge surface (CommonJS by extension)
│   ├── tsconfig.json            NodeNext, so .ts→ESM and .cts→.cjs
│   ├── ipc/
│   │   └── handlers.ts          dialogs, guarded file reads, shell actions
│   └── services/
│       ├── backend.ts           spawn, handshake, supervision, shutdown
│       ├── tools.ts             find FFmpeg: bundled → configured → PATH
│       └── windowState.ts       geometry across launches, display-checked
│
├── src/                         ── RENDERER (React) ──
│   ├── main.tsx                 mount
│   ├── App.tsx                  menu wiring, dialog routing, lifecycle
│   ├── types/
│   │   ├── api.ts               the backend contract
│   │   └── bridge.ts            the preload contract, and window.sf's type
│   ├── lib/
│   │   ├── api.ts               typed client; ApiFailure carries code and hint
│   │   ├── events.ts            SSE with sequence replay
│   │   ├── time.ts              timecodes, frame snapping  (+ time.test.ts)
│   │   └── subtitleText.ts      local measurements        (+ .test.ts)
│   ├── store/
│   │   ├── useAppStore.ts       backend status, capabilities, toasts, dialogs
│   │   ├── useProjectStore.ts   the open project and its settings
│   │   ├── useEditorStore.ts    cues, selection, playhead, undo history
│   │   └── useJobStore.ts       jobs, batches, and post-completion actions
│   ├── hooks/
│   │   └── useKeyboardShortcuts.ts
│   ├── styles/
│   │   └── index.css            Tailwind layers, component classes, fonts
│   └── components/
│       ├── layout/              AppShell, TitleBar, StatusBar, RightPanel
│       ├── panels/              ProjectPanel, QualityPanel
│       ├── preview/             VideoPreview, SubtitleOverlay
│       ├── timeline/            Timeline, WaveformCanvas
│       ├── editor/              SubtitleEditor, CueRow
│       ├── style/               StylePanel
│       ├── batch/               JobQueue
│       ├── dialogs/             Transcribe, Export, Batch, Settings, Projects, Help
│       └── common/              Button, Controls, Modal, Toasts
│
├── backend/                     ── PYTHON ENGINE ──
│   ├── pyproject.toml
│   ├── requirements.txt         runtime
│   ├── requirements-dev.txt     plus pytest, httpx, ruff
│   ├── requirements-optional.txt  pyannote, punctuation model
│   ├── subtitleforge/
│   │   ├── __main__.py          flags, logging, the stdout handshake
│   │   ├── api/                 HTTP only — no logic
│   │   ├── core/                config, db, jobs, events, errors, ids, clock
│   │   ├── db/schema.sql        the whole schema
│   │   ├── models/schemas.py    pydantic request shapes
│   │   └── services/            the work: ffmpeg, media, transcribe, diarize,
│   │                            segmentation, enhance, lexicon, subtitles,
│   │                            styles, render_presets, burn, tracks,
│   │                            projects, pipeline
│   └── tests/                   270 tests, fixtures built by FFmpeg itself
│
├── scripts/
│   ├── build-backend.mjs        PyInstaller freeze, with a smoke test
│   └── fetch-models.mjs         the one network-touching command, run by hand
│
├── build/                       packaging resources
│   ├── installer.nsh            disk-space warning; keep user data on uninstall
│   ├── entitlements.mac.plist
│   └── icon.{ico,icns,png}      (add before packaging)
│
├── assets/
│   └── fonts/                   Inter and JetBrains Mono (see its README)
│
├── resources/                   produced by the build, not in version control
│   ├── backend/                 the frozen Python engine
│   └── bin/                     ffmpeg, ffprobe for the target platform
│
├── dist/                        build output: dist/electron, dist/renderer
├── release/                     installers
│
└── docs/
    ├── PRD.md                   what we are building and for whom
    ├── ARCHITECTURE.md          how the three processes fit together
    ├── DATABASE.md              the schema, and why it is shaped that way
    ├── API.md                   endpoints, events, error codes
    ├── WIREFRAMES.md            the interface, and the reasoning behind it
    ├── FOLDER_STRUCTURE.md      this file
    ├── LIBRARIES.md             every dependency and why it was chosen
    ├── ROADMAP.md               the plan, with what is already done
    ├── INSTALL.md               running it from source
    ├── PACKAGING_WINDOWS.md     producing the installer
    ├── PREMIUM.md               what paid tiers would add
    └── COMMERCIALIZATION.md     pricing, positioning, the business case
```

## The rules that keep it navigable

**Routes contain no logic; services contain no HTTP.** A route parses its
request, calls one service function or submits one job, and serialises the
result. Every service is callable from a test with no client, which is why 270
tests run in under a minute.

**The contract is written down twice, deliberately.** `src/types/api.ts` mirrors
`backend/subtitleforge/models/schemas.py`. Generating one from the other was
considered and rejected: the generated TypeScript of a Python dataclass tree is
less readable than the thing it describes, and this file is what a new
contributor reads first. The cost is discipline when a field changes.

**One place per concept.** The style model is translated to ASS and to CSS in
`services/styles.py` and nowhere else. Timecode formatting lives in
`lib/time.ts` and `services/subtitles.py`, each tested. When the same idea
appears in two files, one of them is wrong eventually.

**Tests sit beside what they test** in the renderer (`time.test.ts` next to
`time.ts`) and in one directory in the backend, where fixtures are shared.

**Nothing generated is committed.** `dist/`, `release/`, `resources/backend/`,
`resources/bin/`, `node_modules/`, `__pycache__/` and the font binaries are all
produced or downloaded, and all ignored.
