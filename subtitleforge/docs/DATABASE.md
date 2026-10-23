# Database schema

SQLite, one file, WAL journaling, foreign keys on. The schema lives in
`backend/subtitleforge/db/schema.sql` and is applied idempotently at startup;
`schema_migrations` records the version so a future change can be additive.

The database holds everything about the work and nothing about the video.
Source media is never copied — 4K footage is too large to duplicate and users
expect their files to stay where they put them — which is why a moved video
needs `relink` rather than a re-import.

## Three decisions worth stating

**All timings are integer milliseconds.** Floating-point seconds drift once
you add, split and merge cues a few thousand times, and the drift shows up as a
caption one frame out. Integers do not drift. ASS stores centiseconds, so
export rounds and import multiplies; SRT and VTT round-trip exactly.

**Identifiers are ULID-style strings**, 26 Crockford base32 characters:
48 bits of millisecond timestamp then 80 bits of randomness. Sorting rows by
`id` sorts them by creation time, which keeps job lists and revision journals
ordered without an extra index, and the renderer can create a row optimistically
before the write lands.

**Anything expensive to compute but cheap to discard is cached here** — probe
output, word timings, waveform peaks, poster paths — rather than recomputed on
every open. Clearing the cache is a supported action that costs the user only
time.

## Tables

### `projects`
The unit a user opens and saves.

| Column | Type | Notes |
| --- | --- | --- |
| `id` | TEXT PK | `prj_…` |
| `name` | TEXT | Defaults to the video's stem |
| `media_id` | TEXT → `media_files` | `ON DELETE SET NULL`: losing the media keeps the cues |
| `active_track_id` | TEXT | Which track the editor opens |
| `settings_json` | TEXT | Style, transcription, segmentation, enhancement and render settings as one document |
| `notes` | TEXT | Free text |
| `archived` | INTEGER | Hidden from the default list, not deleted |
| `created_at`, `updated_at`, `last_opened_at` | TEXT | ISO 8601 UTC |

`settings_json` is a document rather than columns because it is read and
written whole, never queried by field, and its shape changes with the product.
Everything the user might sort or filter by is a real column.

Indexed on `(archived, last_opened_at DESC)` — the recent-projects query.

### `media_files`
The result of probing one file.

`id`, `project_id`, `path`, `filename`, `container`, `size_bytes`,
`duration_ms`, `width`, `height`, `fps`, `video_codec`, `audio_codec`,
`audio_channels`, `audio_sample_rate`, `has_audio`, `probe_json`,
`poster_path`, `waveform_path`, `created_at`.

`probe_json` keeps FFprobe's full output. It costs a few kilobytes and answers
every later question — colour space, stream count, rotation metadata — without
re-probing a file that may be on a disconnected drive.

Unique on `(project_id, path)`, so re-importing the same file into a project
updates the row rather than duplicating it.

### `audio_tracks`
Extracted audio, keyed by purpose.

`id`, `media_id`, `path`, `format`, `codec`, `sample_rate`, `channels`,
`duration_ms`, `size_bytes`, `purpose`, `created_at`.

`purpose` is `asr` (16 kHz mono, extracted automatically) or `export` (what the
user asked for). Separating them means a user's MP3 export never becomes the
file recognition reads.

### `subtitle_tracks`
A project may hold several: a generated track, an imported one for comparison,
a corrected one.

`id`, `project_id`, `name`, `language`, `source`, `model`, `style_id`,
`enhanced`, `cue_count`, `created_at`, `updated_at`.

`source` is `asr`, `import`, `manual` or `translation`. `model` records which
Whisper model produced it, which matters when comparing two attempts.
`cue_count` is denormalised so the project panel can list tracks without
counting rows.

### `cues`
The centre of the schema.

| Column | Type | Notes |
| --- | --- | --- |
| `id` | TEXT PK | `cue_…` |
| `track_id` | TEXT → `subtitle_tracks` | `ON DELETE CASCADE` |
| `idx` | INTEGER | 1-based display order |
| `start_ms`, `end_ms` | INTEGER | `CHECK (end_ms >= start_ms)` |
| `text` | TEXT | With `\n` for the author's line breaks |
| `raw_text` | TEXT | The transcript before enhancement, kept for comparison |
| `speaker_id` | TEXT → `speakers` | `ON DELETE SET NULL` |
| `confidence` | REAL | Mean word probability, 0–1 |
| `style_override_json` | TEXT | Per-cue position, size or colour; becomes ASS override tags |
| `locked` | INTEGER | Excluded from enhancement and from timeline drags |
| `created_at`, `updated_at` | TEXT | |

Indexed on `(track_id, start_ms)` for the timeline's range queries, and unique
on `(track_id, idx)` so two cues can never claim the same position.

### `words`
Word-level timings from Whisper.

`id` (autoincrement), `track_id`, `cue_id`, `start_ms`, `end_ms`, `text`,
`probability`.

This is what makes split accurate: splitting a cue at the caret picks the real
end time of the word before it instead of interpolating by character count. It
is also what makes `resegment` safe — re-cutting to new line limits reuses the
original timings rather than redistributing the old cue boundaries. Karaoke
highlighting in v1.1 needs nothing new.

A two-hour interview holds roughly 20,000 rows here, about 1 MB.

### `speakers`
`id`, `project_id`, `label`, `display_name`, `color`, `created_at`.

`label` is the machine label (`SPEAKER_00`); `display_name` is what the user
typed. Unique on `(project_id, label)`. Renaming a speaker touches one row and
every cue follows, which is why cues reference a speaker row rather than
storing the name.

### `subtitle_styles`
`id`, `project_id`, `name`, `is_preset`, `payload_json`, `created_at`,
`updated_at`.

`project_id IS NULL AND is_preset = 1` is a shipped preset; the five are seeded
on first run and cannot be deleted, only duplicated. A row with a `project_id`
is a style the user saved.

### `render_presets`
`id`, `name`, `is_preset`, `payload_json`, `created_at`. Seeded with Draft,
Web 1080p, Social Vertical, Master 4K and HEVC 4K.

### `jobs`
Every long operation, including completed ones.

| Column | Notes |
| --- | --- |
| `id`, `project_id`, `batch_id` | `batch_id` cascades: deleting a batch deletes its jobs |
| `type` | `probe`, `extract_audio`, `waveform`, `transcribe`, `enhance`, `export_subtitles`, `render`, `batch_item` |
| `status` | `queued`, `running`, `succeeded`, `failed`, `cancelled` |
| `priority` | Lower runs first; transcription 50, render 80, batch items 200+ |
| `progress`, `stage`, `message` | What the status bar shows |
| `payload_json`, `result_json`, `error_json` | The request, the outcome, the coded failure |
| `cancel_requested` | Set by the API, polled by the handler |
| `created_at`, `started_at`, `finished_at` | |

Keeping finished jobs is what lets the user find the output of a render from
yesterday, and what makes a batch's history readable.

### `job_events`
`id`, `job_id`, `ts`, `level`, `stage`, `progress`, `message`. The per-job log
the UI shows when a user opens a failed job: which model loaded, which encoder
was chosen, whether a hardware render fell back to software.

### `batches` and `batch_items`
`batches`: `id`, `name`, `operation`, `options_json`, `status`, `created_at`,
`finished_at`.

`batch_items`: `id`, `batch_id`, `media_path`, `project_id`, `job_id`,
`position`, `status`, `output_path`, `error_json`.

Each item becomes its own project, so a user can open any file from a
forty-file batch afterwards and edit the result. The batch settles its own
status when the last item finishes: `completed`, or `completed_with_errors`.

### `exports`
`id`, `project_id`, `track_id`, `kind`, `path`, `size_bytes`, `settings_json`,
`created_at`. The delivery record — what was produced, from which track, with
which settings. The UI checks whether each file still exists before offering to
reveal it.

### `cue_revisions`
`id`, `track_id`, `created_at`, `label`, `patch_json`.

The editor's undo stack lives in the renderer for responsiveness; every commit
is journalled here with a label ("split cue", "enhanced", "shift -250 ms") so a
crash cannot lose more than the last keystroke batch. Bounded to 200 rows per
track, pruned on write.

### `asr_models`
`name` PK, `path`, `bytes`, `installed`, `checked_at`. A cache of what the
models directory actually contains, refreshed on every capability query. The
installed check looks for `model.bin`, not for the directory, so a half-copied
download is never reported as ready.

### `app_settings`
`key` PK, `value_json`, `updated_at`. Application-wide preferences and the
occasional diagnostic note, such as the duration drift recorded when a relink
points at a file of a different length.

## Relationships

```
projects ──1:0..1──> media_files ──1:n──> audio_tracks
    │                      │
    │                      └──(cached: poster, waveform)
    ├──1:n──> subtitle_tracks ──1:n──> cues ──1:n──> words
    │                │                   │
    │                └──1:n──> cue_revisions
    │                                    │
    ├──1:n──> speakers <─────────────────┘ (speaker_id)
    ├──1:n──> subtitle_styles (project-scoped; presets have no project)
    ├──1:n──> jobs ──1:n──> job_events
    └──1:n──> exports

batches ──1:n──> batch_items ──0..1──> jobs, projects
```

## Growth and maintenance

A one-hour interview with word timings is about 1.5 MB of rows. A heavy user
with two hundred projects stays under 300 MB — comfortable for SQLite, which
handles databases three orders of magnitude larger.

The cache directory is what grows: extracted WAV at 16 kHz mono is about 115 MB
an hour, plus a waveform JSON of 16 KB and a few poster frames. Clearing it per
project or in full is exposed in Settings → Privacy, and deleting a project
clears its cache by default.

WAL mode means three files on disk: the database, `-wal` and `-shm`. The
backend is the only writer, so write contention is limited to its own worker
threads, and a five-second busy timeout absorbs the overlap between a render
thread committing progress and the API thread reading it.
