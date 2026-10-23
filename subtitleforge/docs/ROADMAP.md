# Development roadmap

## Where this build stands

Everything in v1.0 below is implemented in this repository, with 270 backend
tests and 29 renderer tests passing, the renderer and main process both
type-checking and building, and the full pipeline — import, probe, extract,
import subtitles, enhance, export SRT/VTT/ASS, burn in, batch — verified end to
end against real files produced by FFmpeg.

One gap is worth naming before the plan: **real speech recognition has not been
run in this environment**, because the model weights could not be fetched here.
The Faster-Whisper wrapper is covered by tests against a stubbed model — word
and segment conversion, progress, cancellation, the hallucination filter, the
offline guard — and the first task of the next phase is to verify it against
the twenty-file corpus on a machine that has the weights.

## Phase 1 — Foundation (complete)

The architecture decisions that everything later depends on, made once and
tested: three processes with a token handshake, integer-millisecond timings, a
single style model translated to both ASS and CSS, a job queue with real
progress and working cancellation, and SQLite with the schema in one file.

Delivered: project and media management, FFprobe-backed import with honest
refusals, audio extraction in five formats, waveform peaks, the cue model with
SRT/VTT/ASS read and write, the segmenter, the enhancement engine, the five
style presets, burn-in with hardware encoder selection and software fallback,
batch processing, the portable project file, the full editor, and the Windows
packaging configuration.

## Phase 2 — Verification and hardening (two weeks)

The work that turns "it runs" into "it ships".

**Transcription against the corpus.** Twenty files: interviews, lectures,
screencasts, vertical clips, noisy field audio. Measure word error rate per
model, time per model per device, and the share of cues needing a timing fix.
Publish the numbers in the repository. If `small` on CPU does not reach 8% WER
on clean speech, the default changes.

**Calibrate the estimates.** The transcription and render estimates are
currently derived from one measured point each. Replace both with a table
measured across the corpus on three machines — a four-core laptop, an eight-core
desktop, and a machine with an NVIDIA GPU — and show a range rather than a
single number where the variance deserves it.

**The long-file pass.** A two-hour 4K file through the whole pipeline, watching
memory across the run. The known risks are the waveform decode holding chunks
and the word table growing the save transaction; both have a planned fix
(streaming reduction, chunked insert) and neither is worth writing before the
measurement says it is needed.

**Five-user usability test.** New users, no documentation, timed from launch to
first export. The target is under ten minutes. What they ask out loud becomes
the next phase's backlog.

**Packaging on real Windows.** The configuration is written; it has not been
run. Freeze the backend, build the NSIS installer, install on a clean Windows
11 machine with no Python and no FFmpeg, and confirm first launch, a
transcription, a render and an uninstall that keeps the user's projects.

**The FFmpeg licensing decision.** LGPL build from source, or x264 licensed
separately. This blocks any commercial release and is cheap to settle now; see
[LIBRARIES.md](LIBRARIES.md).

## Phase 3 — v1.1, the features users will ask for first (four weeks)

Predicted from what the current build makes obviously missing.

**Karaoke highlighting.** Word-level timings are already stored; this is a
renderer feature and an ASS `\k` emitter. It is also the single most requested
look in short-form video, which makes it the highest-value item in the phase.

**Per-project glossary, promoted.** The enhancer takes one already; the UI
should let a channel enter its recurring names once and have every later
transcript capitalise them, and should feed the same list to Whisper as an
initial prompt.

**Export presets per platform.** YouTube, TikTok, Instagram, Vimeo: each with
its container, dimensions, caption style and reading-speed ceiling, as one
choice.

**Find and replace across a track**, with case and whole-word options. Obvious,
absent, and the first thing an agency will miss.

**A quality pass that fixes rather than reports.** "Fix all reading speeds" and
"resolve all overlaps" as single actions, each one undo step.

**Watch folder.** A directory that processes files as they land, which is what
turns batch processing from a session into a workflow.

## Phase 4 — v1.2, translation (six weeks)

The feature with the largest gap between what users expect and what offline
technology delivers, which is why it gets its own phase and its own evaluation.

Whisper's translate-to-English task is already exposed. General translation
needs a local model — NLLB-200 or an Opus-MT pair — and a quality promise. The
work is: pick the model family on measured quality for the ten languages that
matter most to our audience, build the segment-aware pipeline that translates
cue by cue with surrounding context, re-time the result (translated text is
rarely the same length, and a caption that no longer fits its slot is worse than
no caption), and publish the evaluation alongside, honestly, including where it
is not good enough.

Multi-track comparison lands here too: source and translation side by side,
which is how a bilingual reviewer actually works.

## Phase 5 — v2.0, teams (eight weeks)

The agency and in-house audience, whose problem is not generating captions but
agreeing on them.

A shared style library on a network path, so a team's house style is one file.
Review and approval, with per-cue comments and an approved state. A delivery
manifest recording what was produced from which source with which settings.
Command-line invocation for the users who want this inside a build pipeline.

## What is deliberately not on the roadmap

**Cloud anything.** No sync, no account, no telemetry, not as an optional
extra. The absence is the product, and a product that offers an optional cloud
tier eventually optimises for it.

**Video editing.** We burn captions into a video. Trimming, colour and audio
belong to the editor the user already has.

**A mobile application.** Whisper on a phone is a demonstration, not a tool.

## Sequencing, and why this order

Verification before features, because a captioning tool whose captions are
wrong has no features. Karaoke before translation, because it is a week of
renderer work against data we already store while translation is six weeks and
a quality risk. Teams last, because the agency audience will tolerate waiting
and the creator audience will not.

The one thing that would reorder all of it is the usability test. If five new
users cannot reach an export in ten minutes, nothing in phase 3 matters yet.
