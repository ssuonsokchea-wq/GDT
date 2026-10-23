# Interface design

## The main window

```
┌──────────────────────────────────────────────────────────────────────────────────────┐
│ ▣ SubtitleForge │ Lecture 04 ·12 cues│  [Import video] [✦ Generate] [Enhance] [Export]│  [Batch] [Save] ● │
├────────────────┬─────────────────────────────────────────────────────┬───────────────┤
│ PROJECT    + ⌸ │                                                     │ Editor│Style│Quality│
│                │                                                     ├───────────────┤
│ Video          │                                                     │ Cues   12     │
│ ▣ lecture04.mp4│                                                     │               │
│  /Users/…/Term3│                                                     │ 1 00:00:00.50 │
│                │                                                     │   →00:00:02.40│
│ Duration 42:18 │                   (video, letterboxed)              │   12.4 cps    │
│ Res  1920x1080 │                                                     │  ┌──────────┐ │
│ Rate  25.000   │              ┌───────────────────────┐              │  │Hello guys│ │
│ Size  1.4 GB   │              │ Hello guys, welcome   │              │  │welcome   │ │
│ Video h264     │              │ back.                 │              │  └──────────┘ │
│ Audio aac·2ch  │              └───────────────────────┘              │               │
│                │                                                     │ 2 00:00:03.00 │
│ [Extract audio]│                                                     │   →00:00:05.50│
│ [Show file]    │                                                     │   16.1 cps    │
│                ├─────────────────────────────────────────────────────┤  ┌──────────┐ │
│ Subtitle tracks│ ⏮ ▶ ⏭  00:00:04.120 / 00:42:18   16.1 cps  ↻ ⊞ 🔊──│  │Today we  │ │
│ ▸ EN      12 AI│                                                     │  │are talk… │ │
│   12 cues · en ├─────────────────────────────────────────────────────┤  └──────────┘ │
│   small        │ TIMELINE  ⊖ 60 px/s ⊕  Snap  │ + ✂     00:00:04.120│               │
│                │ ┌─────────────────────────────────────────────────┐ │ 3 00:00:06.10 │
│ [Import subs]  │ │0:00    0:05    0:10    0:15    0:20    0:25     │ │   →00:00:08.90│
│                │ │ ╷  ▁▃▅▇▅▃▁   ▁▂▄▆▄▂▁    ▁▃▅▃▁   ▁▂▃▂▁  ▁▄▆▄▁  │ │   19.8 cps ⚠  │
│ Speakers       │ │ ╷  ───────────────────────────────────────────── │ │  ┌──────────┐ │
│ ● Host      7  │ │ ╷ ▐Hello guys…▌ ▐Today we are…▌  ▐And in this…▌ │ │  │And in    │ │
│ ● Guest     5  │ │ ╵                                               │ │  │this video│ │
│                │ └─────────────────────────────────────────────────┘ │  └──────────┘ │
│ 1 job          │        ▲ playhead          ▲ drag edges to retime   │               │
│ Generating 64% │                                                     │               │
├────────────────┴─────────────────────────────────────────────────────┴───────────────┤
│ Generating subtitles  transcribing ████████░░░ 64%  [Stop]  │ 16.1 cps · 2 to review │
│                                      small · CPU │ 184 GB free │ Live                │
└──────────────────────────────────────────────────────────────────────────────────────┘
```

Four regions, each answering one question, with both dividers draggable and
their widths remembered between launches.

**Left — what am I working on.** The video and its properties, the subtitle
tracks, the speakers, and the job queue at the foot. With no project open this
region becomes the recent list, which is the only sensible first screen for an
application whose first action is "import something".

**Centre — what will the viewer see.** The video with the caption overlay drawn
from the same style the renderer will hand to libass, and a transport bar whose
reading-speed badge turns amber then red as the cue under the playhead gets
harder to read. Title-safe guides toggle on for anyone cutting to a platform
that overlays its own interface.

**Bottom — where is the speech, and where are my captions.** The waveform shows
the first, the blocks show the second, and the gap between them is the entire
job of timing work. Blocks are tinted by reading speed, so a glance across a
forty-minute file finds the problems.

**Right — the words and their look.** Three tabs, because the editor, the style
controls and the quality report are three different activities and only one is
in progress at a time. The quality tab carries a count badge, which is how a
user discovers there is anything to review.

## Why this arrangement

It is the arrangement DaVinci Resolve, Premiere and CapCut all converge on, and
the convergence is not fashion. The eye travels left to right from source to
canvas; time runs along the bottom because time is horizontal in every editing
metaphor; and the properties panel sits on the right because that is where the
dominant hand rests on a mouse.

Deviating would cost recognition for no gain. A captioning tool's novelty
should be in what it does, not in making an experienced editor hunt for the
timeline.

## The generate dialog

```
┌──────────────────────────────────────────────────────────────────────┐
│ Generate subtitles                                                 ✕ │
│ Speech recognition runs on this machine with Faster-Whisper.          │
│ Nothing is uploaded.                                                 │
├──────────────────────────────────────────────────────────────────────┤
│ MODEL                                                                │
│ ┌──────────────────────────────────────────────────────────────────┐ │
│ │ tiny      39M  rough      Live preview and timing checks.  75 MB │ │
│ │                           Expect name and number errors. 1.0 GB  │ │
│ ├──────────────────────────────────────────────────────────────────┤ │
│ │ small ✔  244M  good       The everyday default: good      484 MB │ │
│ │                           accuracy at usable speed.      2.5 GB  │ │
│ ├──────────────────────────────────────────────────────────────────┤ │
│ │ large-v3 1550M best  ⚠not installed   Publication masters 3.1 GB │ │
│ │                           and difficult audio.          10.0 GB  │ │
│ └──────────────────────────────────────────────────────────────────┘ │
│                                                                      │
│ RUN ON                          LANGUAGE                             │
│ [Automatic (CPU)         ▾]     [English                         ▾]  │
│ No CUDA device visible.                                              │
│                                                                      │
│ ┌──────────────────────────────────────────────────────────────────┐ │
│ │ ◉── Skip silence     Faster on sparse audio, and it stops the    │ │
│ │                      model inventing speech over music.          │ │
│ │ ◉── Enhance the text Restore punctuation and capitalisation,     │ │
│ │                      remove fillers.                             │ │
│ │ ──◯ Identify speakers Built-in estimate from pauses and voice    │ │
│ │                      texture. Check it before you rely on it.    │ │
│ └──────────────────────────────────────────────────────────────────┘ │
│                                                                      │
│ NAMES AND JARGON (OPTIONAL)                                          │
│ ┌──────────────────────────────────────────────────────────────────┐ │
│ │ SubtitleForge, libass, Phnom Penh, Dr. Sokha                     │ │
│ └──────────────────────────────────────────────────────────────────┘ │
│                                                                      │
│ 🖳 Estimated 7 min   for 42 min of video. An estimate, not a promise. │
├──────────────────────────────────────────────────────────────────────┤
│                                              [Cancel]  [✦ Generate]  │
└──────────────────────────────────────────────────────────────────────┘
```

The dialog exists to make one decision well. Each model states its parameter
count, its accuracy in a word, what it is good for, its disk cost and its
memory cost — and then the estimate at the foot converts all of that into the
only number the user wants: how long this file will take on this machine. A
model that is not installed says so, and the button that opens the models
folder is right there.

## The export dialog

```
┌──────────────────────────────────────────────────────────────────────┐
│ Export                                     12 cues from "EN".      ✕ │
│ [ Subtitle file ]          [ Video with burned subtitles ]            │
├──────────────────────────────────────────────────────────────────────┤
│ ⚠ 2 cues still fail a check. Overlaps and unreadable reading speeds   │
│   travel into the export. The Quality tab lists them.                │
│                                                                      │
│ QUALITY PRESET                                                       │
│ ┌──────────────────────────────────────────────────────────────────┐ │
│ │ 🖵 Web 1080p ✔   The default upload: 1080p H.264, AAC,     H264  │ │
│ │                  faststart for progressive playback.             │ │
│ ├──────────────────────────────────────────────────────────────────┤ │
│ │ 🖵 Social Vertical  1080x1920 for Shorts, Reels and TikTok. H264 │ │
│ │                  Pads rather than crops, so nothing is lost.     │ │
│ └──────────────────────────────────────────────────────────────────┘ │
│                                                                      │
│ AUDIO                           Quality (lower is better)       21   │
│ [Copy unchanged           ▾]    ─────────●────────────────           │
│ Copying is instant and          ◉── Use the GPU when available       │
│ lossless.                           Several times faster.            │
│                                                                      │
│ ┌─ WHAT WILL HAPPEN ───────────────────────────────────────────────┐ │
│ │ Encoder          libx264         Output size    1920x1080        │ │
│ │ Estimated time   18 min          Estimated file  1.2 GB          │ │
│ │ /Users/sam/Videos/lecture04_subtitled.mp4                        │ │
│ │ ⚠ No usable hardware encoder was found, so this will be encoded  │ │
│ │   by the CPU. It will work; it will take longer.                 │ │
│ └──────────────────────────────────────────────────────────────────┘ │
│                                                                      │
│ 🎞 Burned captions become part of the picture: they cannot be switched│
│    off. Keep the SRT as well if you may need an editable version.    │
├──────────────────────────────────────────────────────────────────────┤
│                                              [Cancel]  [🔥 Render]    │
└──────────────────────────────────────────────────────────────────────┘
```

The render plan is the point of this screen. A two-hour 4K encode is not
something to discover was wrong afterwards, so the dialog states the encoder it
will use, the resolution it will write, the time it expects to take, the size it
expects to produce and the exact path — recomputed whenever a setting changes,
before a single frame is encoded.

For subtitle files the equivalent honesty is a text preview of the actual
output, which is how a user discovers that their ASS export carries the style
and their SRT does not.

## The batch window

```
┌───────────────────────────────────────────────────────────────────────────┐
│ Batch processing     Queue many videos and leave them to run.           ✕ │
├──────────────────────────────────────────────┬────────────────────────────┤
│ FILES  3            [+ Add videos] [Clear]   │ OPERATION                  │
│ ┌──────────────────────────────────────────┐ │ ┌────────────────────────┐ │
│ │ lecture01.mp4                          ✕ │ │ │ Generate subtitles     │ │
│ │ lecture02.mp4                          ✕ │ │ │ One project per file.  │ │
│ │ lecture03.mp4                          ✕ │ │ ├────────────────────────┤ │
│ └──────────────────────────────────────────┘ │ │ Generate and burn in ✔ │ │
│                                              │ │ Transcribe, then render│ │
│ HISTORY                                      │ │ a copy with captions.  │ │
│ ┌──────────────────────────────────────────┐ │ └────────────────────────┘ │
│ │ 12 files      completed_with_errors 11/12│ │                            │
│ │ ████████████████████████████████░ 92%    │ │ MODEL                      │
│ │ ✔ term2-week01.mp4               show    │ │ [small · good          ▾]  │
│ │ ✔ term2-week02.mp4               show    │ │                            │
│ │ ✖ term2-week03.mp4            no_audio   │ │ RENDER PRESET              │
│ └──────────────────────────────────────────┘ │ [Web 1080p             ▾]  │
│                                              │                            │
│                                              │ OUTPUT FOLDER              │
│                                              │ [🗀 /Volumes/Term3/captions]│
├──────────────────────────────────────────────┴────────────────────────────┤
│                                                  [Close]  [▶ Start (3)]   │
└───────────────────────────────────────────────────────────────────────────┘
```

A course author with forty lecture recordings has a different problem from
someone captioning one video: they do not want to watch. So the batch runs one
file at a time in the background, each file becomes a project they can open
afterwards, and every row says exactly what happened — including the one that
failed, with its reason as a code the user can act on.

## Visual language

A single neutral ramp from near-black panels to light text, with a hair of blue
in the greys and one saturated accent. Three signal colours carry meaning and
are never decorative: green for a passed check, amber for "look at this", red
for "this is wrong".

| Token | Hex | Used for |
| --- | --- | --- |
| `panel-950` | `#0A0C10` | The video surround, so nothing competes with the image |
| `panel-900` | `#0F1218` | Panel backgrounds |
| `panel-750` | `#222834` | Hairlines and dividers |
| `ink-100` | `#F3F5F9` | Primary text |
| `ink-400` | `#8089A0` | Labels and secondary text |
| `accent` | `#3B82F6` | Selection, primary actions, the playhead region |
| `signal-ok` | `#34D399` | Passed checks, available hardware |
| `signal-warn` | `#FBBF24` | Fast reading speed, missing font, software fallback |
| `signal-error` | `#F87171` | Overlaps, failures, the playhead |
| `signal-speech` | `#38BDF8` | The waveform |

Inter for the interface, JetBrains Mono for every timecode and number. Monospace
for timings is not an aesthetic choice: proportional digits make a column of
timecodes impossible to scan, and scanning that column is most of what timing
work consists of.

Type runs from 11 px for labels to 14 px for body. Spacing is a 4-pixel grid.
Transitions are 120 ms and only on colour — nothing in a timeline should
animate its position while a user is dragging it.

## Interaction rules

**Every long operation shows real progress and stops when asked.** Progress
comes from FFmpeg's `out_time_us` and Whisper's segment timestamps, never from
a timer pretending.

**Nothing is rewritten silently.** Changing the line limits offers to re-cut and
says what that replaces. The original transcript survives enhancement in
`raw_text`.

**The keyboard is complete.** Space plays, J and L step between cues, arrows
nudge the playhead, Shift+Enter splits at the caret, Ctrl+Z undoes a hundred
steps. Shortcuts never fire while the user is typing, which is the rule that
makes "Space plays" survivable in a window full of textareas.

**Empty states do the teaching.** No project, no video, no subtitles and no
model installed each explain the next action in a sentence and offer the button
that performs it. There is no separate onboarding, because an application whose
first screen explains itself does not need one.
