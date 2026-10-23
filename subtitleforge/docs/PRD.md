# SubtitleForge AI — Product Requirements

## The problem worth solving

Captioning a video is cheap labour done badly or expensive labour done well,
and the tools in between leak your footage. A YouTuber uploading a 40-minute
episode to a cloud captioning service hands over unreleased work, waits for an
upload on a domestic connection, and pays per minute. An in-house team at a
hospital, a law firm or a school often cannot use those services at all: the
footage contains patients, clients or children, and the compliance answer to
"where does the audio go?" has to be "nowhere".

Meanwhile the technology to do this locally arrived and nobody packaged it.
Whisper-class speech recognition runs on a laptop. FFmpeg and libass render
broadcast-quality captions. What is missing is the two days of plumbing between
a Python script and something a content team can use at nine in the morning.

**SubtitleForge AI is that package: subtitle generation, editing, styling and
burn-in, entirely on the user's own machine, with no account and no network.**

## Who it is for

Five audiences, in the order they will arrive.

**Independent creators** — YouTubers, podcasters with video, course authors.
They publish weekly, they care that captions look like their brand, and they
are the audience most likely to compare us to CapCut. They want the whole job
done in one window in under ten minutes.

**Educators and course producers** accumulate dozens of lecture recordings a
term. They need batch processing more than they need a timeline, and accuracy
on technical vocabulary more than they need style presets.

**Agencies and post-production teams** deliver captions as a line item. They
need SRT and ASS files to a client's house style, reading-speed compliance they
can point at, and a project file they can hand to a colleague.

**Privacy-bound organisations** — healthcare, legal, government, HR. For them
"runs offline" is not a feature, it is the procurement requirement that decides
whether a tool can be installed at all. They will pay more and ask for less.

**Localisation teams** are the audience the roadmap grows towards, not the one
version one serves: they need translation, which v1 deliberately does not
attempt beyond Whisper's own translate-to-English task.

## What the product does

The user imports a video, presses one button, and gets accurate, readable,
styled captions they can correct and then either export as a file or burn into
a copy of the video.

Ten capabilities carry that sentence.

**Import** reads MP4, MOV, MKV, AVI and WEBM, shows duration, resolution and
frame rate before anything is written, and refuses — with a reason — a file
that has no audio.

**Audio extraction** pulls a 16 kHz mono track for recognition automatically,
and can save MP3, WAV, AAC, M4A or FLAC when the user wants the audio itself.

**Transcription** runs Faster-Whisper locally in five model sizes, from `tiny`
for a timing check to `large-v3` for a publication master. The user picks, with
each model's disk, memory and speed cost stated, and an estimate for the file
in front of them.

**Segmentation** turns words into captions: two lines of about 42 characters,
under 21 characters a second, broken at sentence and clause boundaries rather
than at a character count. This is the difference between a transcript chopped
into squares and something that reads.

**Enhancement** restores punctuation and sentence case, removes fillers and
stutters, and fixes the spellings that are wrong in every context. Every change
is reported with its kind, and the original transcript is kept.

**The editor** gives a waveform timeline with draggable cues, a cue list with
typed timecodes, split and merge that use the real word timings, and a hundred
steps of undo.

**Styling** offers five presets — Netflix, YouTube, TikTok, Documentary,
Minimalist — and full control of font, size, colour, outline, shadow, box,
position and line limits. The live preview is drawn from the same style model
the renderer hands to libass, so the preview is not an approximation.

**Burn-in** renders a copy of the video with the captions in the picture, using
hardware encoding where the machine has it and falling back to software with an
explanation when the driver refuses.

**Batch processing** queues many files through any of those operations, one at
a time, writing each result beside the source or into a chosen folder.

**Projects** save the video's path, every cue, the style and the export
settings, and reopen them. A portable `.sfproj` file carries the work to
another machine that has the same footage.

## What it deliberately does not do in version one

A product is also its refusals.

**No translation beyond Whisper's own.** Offline machine translation of good
enough quality needs another model family, another gigabyte, and a quality
promise we cannot yet keep. Whisper's translate-to-English task is exposed; a
general translation pipeline is a v1.2 feature with its own evaluation.

**No research-grade speaker diarization by default.** Real diarization means
`pyannote`, which means gated model weights and a 2 GB dependency. The built-in
speaker estimate uses pauses and spectral fingerprints, is honest about being
an estimate, and is fully editable. Users who install `pyannote` get the better
path automatically.

**No cloud sync, no account, no telemetry.** Not as a later addition either:
the absence is the product.

**No video editing.** We burn captions into a video. Trimming, colour and audio
belong to the editor the user already has.

## How we will know it works

Four numbers, measured on a fixed 20-file corpus (interviews, lectures,
screencasts, vertical social clips, noisy field audio) before every release.

| Measure | Target | Why this number |
| --- | --- | --- |
| Word error rate, `small` model, clean speech | under 8% | Below this, correction is faster than retyping, which is the threshold where the tool saves time rather than moving it |
| Cues needing a timing fix | under 5% | A user who adjusts one cue in twenty is editing; one in four is redoing the work |
| Average reading speed of generated captions | 14–18 cps | Inside the broadcast comfort band without padding cues into silence |
| Time to first caption, 10-minute file, `small` on CPU | under 3 minutes | Slower than this and users leave the room, which turns a tool into a batch job |

Two product measures matter as much. **Time from launch to first export** for a
new user should be under ten minutes with no documentation; we test this with
five people per release. And **the share of exports that are burned video
rather than subtitle files** tells us whether we are a captioning utility or a
publishing tool — we expect it to rise, and we design for it rising.

## Performance requirements

The tool must stay usable on the hardware its audience owns, not on a
workstation.

A two-hour 4K file must import, show a waveform and scrub without the window
dropping frames. That rules out decoding video in the renderer for the
timeline: the waveform is computed once into a few thousand peak pairs, and the
preview seeks through a range-request stream rather than loading the file.

Transcription must survive a two-hour file without accumulating memory. Whisper
decodes a 30-second window at a time; the backend holds one model, streams
segments as they arrive, and writes them once at the end.

Rendering must use the GPU when the machine has one — NVENC, Quick Sync, AMF,
VideoToolbox — and must not fail when it does not. A hardware encoder failure
retries in software automatically and says so, because a driver that refuses a
4K B-frame setting is common and not the user's problem to diagnose.

One job runs at a time by default. Two concurrent 4K renders on a four-core
laptop finish later than two sequential ones and make the machine unusable in
between.

## The experience we are aiming at

The window is one place, dark, four regions: projects at the left, the video in
the centre, the timeline across the bottom, the editor and style controls at
the right. That arrangement is not a borrowing from DaVinci Resolve and Premiere
for the sake of familiarity — it follows the eye's path from source to canvas to
time, and puts the controls where the dominant hand rests.

Three principles decide the details.

**Every long operation is visible and cancellable.** Progress comes from real
positions — FFmpeg's `out_time_us`, Whisper's segment timestamps — not from a
spinner, and the stop button works immediately.

**Every failure names its cause and its remedy.** "FFmpeg not found" carries
the instruction to install it or point Settings at a binary. "The large model
needs 10 GB of VRAM" carries the suggestion to switch device. A stack trace is
never the user-facing message.

**Nothing happens behind the user's back.** Models are never downloaded
automatically. Captions are never silently rewritten: changing the line limits
offers to re-cut and explains what that replaces. The one network-touching
command is a separate script the application never calls.

## Release scope

**v1.0, the scope of this build.** Import, probe, extract, transcribe,
segment, enhance, edit, style, export SRT/VTT/ASS, burn in, batch, projects,
Windows installer.

**v1.1.** Word-level karaoke highlighting, which the data model already stores.
Custom glossary per project. Export presets per platform.

**v1.2.** Offline translation, with its own quality evaluation published
alongside. Multi-track comparison view.

**v2.0.** Team features for the agency audience: a shared style library, review
and approval, a watch folder that processes files as they land.
