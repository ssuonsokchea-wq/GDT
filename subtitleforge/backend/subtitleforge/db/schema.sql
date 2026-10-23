-- SubtitleForge AI — SQLite schema (migration 001)
--
-- Design notes
--   * All timings are stored as integer milliseconds. Floating-point seconds
--     drift once you add, split and merge cues thousands of times.
--   * Identifiers are ULID-like strings generated in Python so the renderer can
--     create a row optimistically before the write lands.
--   * Anything expensive to recompute but cheap to discard (probe output, word
--     timings, waveform peaks) is cached here rather than recomputed per open.

PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS schema_migrations (
    version    INTEGER PRIMARY KEY,
    name       TEXT NOT NULL,
    applied_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS app_settings (
    key        TEXT PRIMARY KEY,
    value_json TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS projects (
    id             TEXT PRIMARY KEY,
    name           TEXT NOT NULL,
    media_id       TEXT REFERENCES media_files(id) ON DELETE SET NULL,
    active_track_id TEXT,
    settings_json  TEXT NOT NULL DEFAULT '{}',
    notes          TEXT,
    archived       INTEGER NOT NULL DEFAULT 0,
    created_at     TEXT NOT NULL,
    updated_at     TEXT NOT NULL,
    last_opened_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_projects_recent ON projects(archived, last_opened_at DESC);

CREATE TABLE IF NOT EXISTS media_files (
    id               TEXT PRIMARY KEY,
    project_id       TEXT REFERENCES projects(id) ON DELETE CASCADE,
    path             TEXT NOT NULL,
    filename         TEXT NOT NULL,
    container        TEXT,
    size_bytes       INTEGER,
    duration_ms      INTEGER,
    width            INTEGER,
    height           INTEGER,
    fps              REAL,
    video_codec      TEXT,
    audio_codec      TEXT,
    audio_channels   INTEGER,
    audio_sample_rate INTEGER,
    has_audio        INTEGER NOT NULL DEFAULT 1,
    probe_json       TEXT,
    poster_path      TEXT,
    waveform_path    TEXT,
    created_at       TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_media_project ON media_files(project_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_media_project_path ON media_files(project_id, path);

CREATE TABLE IF NOT EXISTS audio_tracks (
    id          TEXT PRIMARY KEY,
    media_id    TEXT NOT NULL REFERENCES media_files(id) ON DELETE CASCADE,
    path        TEXT NOT NULL,
    format      TEXT NOT NULL,
    codec       TEXT,
    sample_rate INTEGER,
    channels    INTEGER,
    duration_ms INTEGER,
    size_bytes  INTEGER,
    purpose     TEXT NOT NULL DEFAULT 'asr',   -- 'asr' | 'export'
    created_at  TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_audio_media ON audio_tracks(media_id);

CREATE TABLE IF NOT EXISTS subtitle_tracks (
    id           TEXT PRIMARY KEY,
    project_id   TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    name         TEXT NOT NULL,
    language     TEXT NOT NULL DEFAULT 'en',
    source       TEXT NOT NULL DEFAULT 'asr',  -- 'asr' | 'import' | 'manual' | 'translation'
    model        TEXT,
    style_id     TEXT REFERENCES subtitle_styles(id) ON DELETE SET NULL,
    enhanced     INTEGER NOT NULL DEFAULT 0,
    cue_count    INTEGER NOT NULL DEFAULT 0,
    created_at   TEXT NOT NULL,
    updated_at   TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_tracks_project ON subtitle_tracks(project_id);

CREATE TABLE IF NOT EXISTS cues (
    id         TEXT PRIMARY KEY,
    track_id   TEXT NOT NULL REFERENCES subtitle_tracks(id) ON DELETE CASCADE,
    idx        INTEGER NOT NULL,
    start_ms   INTEGER NOT NULL,
    end_ms     INTEGER NOT NULL,
    text       TEXT NOT NULL DEFAULT '',
    raw_text   TEXT,                            -- pre-enhancement transcript
    speaker_id TEXT REFERENCES speakers(id) ON DELETE SET NULL,
    confidence REAL,
    style_override_json TEXT,
    locked     INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    CHECK (end_ms >= start_ms)
);

CREATE INDEX IF NOT EXISTS idx_cues_track_time ON cues(track_id, start_ms);
CREATE UNIQUE INDEX IF NOT EXISTS idx_cues_track_idx ON cues(track_id, idx);

CREATE TABLE IF NOT EXISTS words (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    track_id    TEXT NOT NULL REFERENCES subtitle_tracks(id) ON DELETE CASCADE,
    cue_id      TEXT REFERENCES cues(id) ON DELETE SET NULL,
    start_ms    INTEGER NOT NULL,
    end_ms      INTEGER NOT NULL,
    text        TEXT NOT NULL,
    probability REAL
);

CREATE INDEX IF NOT EXISTS idx_words_track_time ON words(track_id, start_ms);
CREATE INDEX IF NOT EXISTS idx_words_cue ON words(cue_id);

CREATE TABLE IF NOT EXISTS speakers (
    id           TEXT PRIMARY KEY,
    project_id   TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    label        TEXT NOT NULL,                 -- 'SPEAKER_00'
    display_name TEXT,
    color        TEXT,
    created_at   TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_speakers_project_label ON speakers(project_id, label);

CREATE TABLE IF NOT EXISTS subtitle_styles (
    id         TEXT PRIMARY KEY,
    project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,  -- NULL = global/preset
    name       TEXT NOT NULL,
    is_preset  INTEGER NOT NULL DEFAULT 0,
    payload_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_styles_scope ON subtitle_styles(project_id, is_preset);

CREATE TABLE IF NOT EXISTS render_presets (
    id         TEXT PRIMARY KEY,
    name       TEXT NOT NULL,
    is_preset  INTEGER NOT NULL DEFAULT 0,
    payload_json TEXT NOT NULL,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS jobs (
    id               TEXT PRIMARY KEY,
    project_id       TEXT REFERENCES projects(id) ON DELETE SET NULL,
    batch_id         TEXT REFERENCES batches(id) ON DELETE CASCADE,
    type             TEXT NOT NULL,             -- probe|extract_audio|transcribe|enhance|render|export
    status           TEXT NOT NULL,             -- queued|running|succeeded|failed|cancelled
    priority         INTEGER NOT NULL DEFAULT 100,
    progress         REAL NOT NULL DEFAULT 0,
    stage            TEXT,
    message          TEXT,
    payload_json     TEXT NOT NULL DEFAULT '{}',
    result_json      TEXT,
    error_json       TEXT,
    cancel_requested INTEGER NOT NULL DEFAULT 0,
    created_at       TEXT NOT NULL,
    started_at       TEXT,
    finished_at      TEXT
);

CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status, priority, created_at);
CREATE INDEX IF NOT EXISTS idx_jobs_project ON jobs(project_id, created_at DESC);

CREATE TABLE IF NOT EXISTS job_events (
    id       INTEGER PRIMARY KEY AUTOINCREMENT,
    job_id   TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
    ts       TEXT NOT NULL,
    level    TEXT NOT NULL DEFAULT 'info',
    stage    TEXT,
    progress REAL,
    message  TEXT
);

CREATE INDEX IF NOT EXISTS idx_job_events_job ON job_events(job_id, id);

CREATE TABLE IF NOT EXISTS batches (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    operation   TEXT NOT NULL,                  -- transcribe|burn|transcribe_and_burn|export
    options_json TEXT NOT NULL DEFAULT '{}',
    status      TEXT NOT NULL DEFAULT 'queued',
    created_at  TEXT NOT NULL,
    finished_at TEXT
);

CREATE TABLE IF NOT EXISTS batch_items (
    id          TEXT PRIMARY KEY,
    batch_id    TEXT NOT NULL REFERENCES batches(id) ON DELETE CASCADE,
    media_path  TEXT NOT NULL,
    project_id  TEXT REFERENCES projects(id) ON DELETE SET NULL,
    job_id      TEXT REFERENCES jobs(id) ON DELETE SET NULL,
    position    INTEGER NOT NULL DEFAULT 0,
    status      TEXT NOT NULL DEFAULT 'queued',
    output_path TEXT,
    error_json  TEXT
);

CREATE INDEX IF NOT EXISTS idx_batch_items ON batch_items(batch_id, position);

CREATE TABLE IF NOT EXISTS exports (
    id         TEXT PRIMARY KEY,
    project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
    track_id   TEXT REFERENCES subtitle_tracks(id) ON DELETE SET NULL,
    kind       TEXT NOT NULL,                   -- srt|vtt|ass|mp4
    path       TEXT NOT NULL,
    size_bytes INTEGER,
    settings_json TEXT,
    created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_exports_project ON exports(project_id, created_at DESC);

-- Editor history is kept in the renderer for responsiveness, but every commit is
-- journalled here so a crash cannot lose more than the last keystroke batch.
CREATE TABLE IF NOT EXISTS cue_revisions (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    track_id   TEXT NOT NULL REFERENCES subtitle_tracks(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL,
    label      TEXT,
    patch_json TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_cue_revisions_track ON cue_revisions(track_id, id DESC);

CREATE TABLE IF NOT EXISTS asr_models (
    name        TEXT PRIMARY KEY,               -- tiny|base|small|medium|large-v3
    path        TEXT,
    bytes       INTEGER,
    installed   INTEGER NOT NULL DEFAULT 0,
    checked_at  TEXT
);
