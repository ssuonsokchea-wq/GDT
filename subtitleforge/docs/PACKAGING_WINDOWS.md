# Packaging for Windows

The goal is a single installer that works on a clean Windows 11 machine with no
Python, no FFmpeg and no developer tools. That means three things ship inside
it: the Electron application, the frozen Python engine, and FFmpeg.

Speech models do not. `large-v3` alone is 3.1 GB, and an installer that size is
hostile; models are fetched once, afterwards, by a command the application
never calls.

## Before you start: the licensing decision

**This blocks any commercial release, so settle it first.**

Most prebuilt Windows FFmpeg binaries are GPL builds, because they include
x264. Shipping a GPL FFmpeg with a closed-source application makes the
application GPL. Two lawful paths:

1. **Build FFmpeg from source under LGPL 2.1** — omit `--enable-gpl` and
   `--enable-libx264`, and use the native `h264_mf` (Media Foundation) encoder
   or a hardware encoder for H.264 output. Link dynamically and include the
   licence notice.
2. **License x264 commercially** from its rights holder, and keep the GPL build.

For an open-source release neither applies: ship the GPL build and license the
application under GPL.

The application's own code does not care which build it finds — it discovers
encoders at runtime and tells the user what is available — so this is a
packaging decision, not a code change. See the encoder list in Settings →
Hardware to confirm what a given build exposes.

## One-time setup

```powershell
# Node 20 or later, Python 3.11, and the Visual C++ build tools
winget install OpenJS.NodeJS.LTS
winget install Python.Python.3.11
winget install Microsoft.VisualStudio.2022.BuildTools

git clone <this repository>
cd subtitleforge
npm install

python -m venv backend\.venv
backend\.venv\Scripts\activate
pip install -r backend\requirements.txt
pip install pyinstaller==6.11.1
```

### Put FFmpeg where the build expects it

```
resources\bin\ffmpeg.exe
resources\bin\ffprobe.exe
```

`electron-builder.yml` copies that folder to `resources\bin` inside the
installed application, and `electron/services/tools.ts` looks there first. A
user with no FFmpeg on their `PATH` therefore has a working application, which
is the whole point of bundling it.

### Icons

```
build\icon.ico     256x256 and down, for Windows
build\icon.png     512x512, for Linux
build\icon.icns    for macOS
```

## Build

```powershell
$env:SF_PYTHON = "$PWD\backend\.venv\Scripts\python.exe"
npm run package:win
```

That runs four steps in order:

**1. The renderer** — `vite build` into `dist\renderer`, with a relative base
so every asset path resolves under `file://`.

**2. The main process** — `tsc` into `dist\electron`. The `NodeNext` setting is
what makes `main.ts` emit ESM and `preload.cts` emit `preload.cjs`, which is
what a preload script has to be.

**3. The engine** — `scripts\build-backend.mjs` runs PyInstaller in `--onedir`
mode into `resources\backend`. One directory rather than one file, because a
300 MB `--onefile` build unpacks to the temp directory on *every* launch and
adds seconds to startup. The script collects `ctranslate2` and `faster_whisper`
wholesale (both load parts of themselves dynamically, so static analysis misses
them), bundles `schema.sql` (without it the first launch cannot create its
database), and then runs the frozen binary with `--help` as a smoke test. If
that fails, the build stops there rather than producing an installer that
cannot start.

**4. The installer** — electron-builder produces
`release\SubtitleForge-AI-Setup-1.0.0-x64.exe`, around 400 MB.

## What the installer does

NSIS, not one-click: the user chooses the directory, because the cache and
models can grow to several gigabytes and that belongs on the drive they choose.

`build\installer.nsh` adds two behaviours worth having. Before installing it
checks free space and warns below 2 GB, naming the model sizes that will follow
— better than a failed transcription three days later. On uninstall it asks
whether to keep projects and models, defaulting to keeping them: they are the
user's work and their multi-gigabyte downloads, not application files.

`.sfproj` is registered to the application, so a project file opens by
double-click.

## Code signing

Unsigned, Windows SmartScreen will warn every user who downloads the installer,
and most will stop. An EV certificate from DigiCert, Sectigo or SSL.com builds
reputation immediately; a standard OV certificate works but accumulates
SmartScreen reputation over weeks of downloads.

```powershell
$env:CSC_LINK = "C:\certs\subtitleforge.pfx"
$env:CSC_KEY_PASSWORD = "…"
npm run package:win
```

electron-builder signs the application and the installer. On a build server,
pass these as secrets and never commit the certificate.

## Verify on a clean machine

A virtual machine with a fresh Windows 11, no Python, no FFmpeg, no Visual C++
redistributable beyond what the OS ships.

1. The installer runs and offers a directory.
2. The application opens and the engine starts — Settings → Hardware shows
   FFmpeg found as `bundled` and a model list that is empty but correct.
3. `node scripts/fetch-models.mjs small`, or copy a models folder in; the model
   appears after Re-scan.
4. Import a short MP4. Duration, resolution and frame rate are right.
5. Generate subtitles. Progress moves, cancellation works, cues appear.
6. Edit a cue, drag it in the timeline, undo.
7. Export an SRT; open it in Notepad.
8. Render a burn-in; play the result and confirm the captions are in the
   picture.
9. Close and reopen the application — the project is there.
10. Uninstall, choosing to keep user data, and confirm
    `%APPDATA%\SubtitleForge` survives.

Steps 2, 5 and 8 are the ones that catch packaging errors. A missing
`schema.sql` fails at 2; a missing CTranslate2 DLL fails at 5; a missing FFmpeg
fails at 8.

## Size, and where it goes

| | Approximate |
| --- | --- |
| Electron runtime | 180 MB |
| Frozen Python engine with CTranslate2 | 180 MB |
| FFmpeg and FFprobe | 90 MB |
| Renderer bundle, fonts, icons | 3 MB |
| **Installer** | **~400 MB** |
| Installed | ~520 MB |
| Plus each model | 75 MB – 3.1 GB |

If that needs to come down, the two levers are an LGPL FFmpeg built with only
the codecs this application uses (saves perhaps 50 MB) and excluding unused
CTranslate2 compute backends (saves perhaps 40 MB). Neither is worth doing
before the first release.

## Other platforms

The same configuration produces a DMG for macOS (arm64 and x64) and an AppImage
and `.deb` for Linux. macOS additionally needs notarisation —
`APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD` and `APPLE_TEAM_ID` in the
environment — and the hardened-runtime entitlements in
`build/entitlements.mac.plist`, which allow the unsigned-executable memory that
a frozen Python binary needs.

## A build server, in outline

```yaml
# .github/workflows/release.yml — sketch
on:
  push:
    tags: ['v*']
jobs:
  windows:
    runs-on: windows-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20 }
      - uses: actions/setup-python@v5
        with: { python-version: '3.11' }
      - run: npm ci
      - run: pip install -r backend/requirements.txt pyinstaller==6.11.1
      - run: npm run test:backend
      - run: npm test
      - run: npm run typecheck
      - name: Fetch the bundled FFmpeg
        run: ./scripts/ci/fetch-ffmpeg.ps1   # your licence-appropriate build
      - run: npm run package:win
        env:
          CSC_LINK: ${{ secrets.WINDOWS_CERT }}
          CSC_KEY_PASSWORD: ${{ secrets.WINDOWS_CERT_PASSWORD }}
      - uses: actions/upload-artifact@v4
        with: { path: release/*.exe }
```

The three test steps before packaging are not ceremony: a type error in the
main process produces an installer that opens a blank window, and that is the
one failure a user cannot work around.
