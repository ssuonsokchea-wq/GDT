/**
 * The backend contract, as the renderer sees it.
 *
 * These types mirror `backend/subtitleforge/models/schemas.py` and the shapes
 * the services return. They are hand-written rather than generated because the
 * generated version of a Python dataclass tree is less readable than the thing
 * it describes, and this file is the document a new contributor reads first.
 */

export interface ApiError {
  code: string;
  message: string;
  hint?: string | null;
  details?: Record<string, unknown>;
}

// ---------------------------------------------------------------- media

export interface MediaProbe {
  path: string;
  filename: string;
  container: string | null;
  sizeBytes: number | null;
  durationMs: number | null;
  width: number | null;
  height: number | null;
  fps: number | null;
  videoCodec: string | null;
  audioCodec: string | null;
  audioChannels: number | null;
  audioSampleRate: number | null;
  hasAudio: boolean;
}

export interface MediaFile {
  id: string;
  project_id: string | null;
  path: string;
  filename: string;
  container: string | null;
  size_bytes: number | null;
  duration_ms: number | null;
  width: number | null;
  height: number | null;
  fps: number | null;
  video_codec: string | null;
  audio_codec: string | null;
  audio_channels: number | null;
  audio_sample_rate: number | null;
  has_audio: number;
  poster_path: string | null;
  waveform_path: string | null;
  exists?: boolean;
}

export interface Waveform {
  mediaId: string;
  durationMs: number;
  buckets: number;
  msPerBucket: number;
  peaks: Array<[number, number]>;
}

// ---------------------------------------------------------------- subtitles

export interface Word {
  startMs: number;
  endMs: number;
  text: string;
  probability: number | null;
}

export interface Cue {
  id: string | null;
  idx: number;
  startMs: number;
  endMs: number;
  text: string;
  rawText: string | null;
  speaker: string | null;
  confidence: number | null;
  styleOverride: Partial<SubtitleStyle> | null;
  locked: boolean;
  cps: number;
  words: Word[];
}

export interface SubtitleTrack {
  id: string;
  project_id: string;
  name: string;
  language: string;
  source: 'asr' | 'import' | 'manual' | 'translation';
  model: string | null;
  style_id: string | null;
  enhanced: number;
  cue_count: number;
  created_at: string;
  updated_at: string;
  cues?: Cue[];
}

export interface Speaker {
  id: string;
  project_id: string;
  label: string;
  display_name: string | null;
  color: string | null;
}

export type QualitySeverity = 'error' | 'warn' | 'info';

export interface QualityIssue {
  cueIdx: number;
  kind:
    | 'too_short'
    | 'too_long'
    | 'reading_speed'
    | 'line_length'
    | 'line_count'
    | 'overlap'
    | 'empty';
  severity: QualitySeverity;
  message: string;
}

export interface QualityReport {
  cueCount: number;
  totalChars: number;
  speakingMs: number;
  averageCps: number;
  issues: QualityIssue[];
  counts: Record<QualitySeverity, number>;
}

// ---------------------------------------------------------------- styles

export interface SubtitleStyle {
  name?: string;
  description?: string;
  fontFamily: string;
  fontSize: number;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  strikeout: boolean;
  primaryColor: string;
  secondaryColor: string;
  outlineColor: string;
  shadowColor: string;
  backColor: string;
  textOpacity: number;
  outlineOpacity: number;
  shadowOpacity: number;
  boxOpacity: number;
  borderStyle: 'outline' | 'box';
  outlineWidth: number;
  shadowDepth: number;
  alignment: number;
  marginLeft: number;
  marginRight: number;
  marginVertical: number;
  letterSpacing: number;
  scaleX: number;
  scaleY: number;
  angle: number;
  uppercase: boolean;
  maxCharsPerLine: number;
  maxLines: number;
}

export interface StyleRecord {
  id: string;
  name: string;
  projectId: string | null;
  isPreset: boolean;
  payload: SubtitleStyle;
}

export interface StylePreview {
  style: SubtitleStyle;
  css: Record<string, string>;
  assStyleLine: string;
}

// ---------------------------------------------------------------- projects

export interface ProjectSettings {
  style: SubtitleStyle;
  transcription: TranscriptionOptions;
  segmentation: SegmentationOptions;
  enhancement: EnhancementOptions;
  render: RenderOptions;
  [key: string]: unknown;
}

export interface Project {
  id: string;
  name: string;
  media_id: string | null;
  active_track_id: string | null;
  notes: string | null;
  archived: number;
  created_at: string;
  updated_at: string;
  last_opened_at: string | null;
  settings: ProjectSettings;
  media: MediaFile | null;
  tracks: SubtitleTrack[];
  speakers: Speaker[];
  cues?: Cue[];
  mediaMissing?: boolean;
}

export interface ProjectSummary {
  id: string;
  name: string;
  media_id: string | null;
  archived: number;
  updated_at: string;
  last_opened_at: string | null;
  settings: ProjectSettings;
  media_path?: string | null;
  media_filename?: string | null;
  duration_ms?: number | null;
  width?: number | null;
  height?: number | null;
  poster_path?: string | null;
  mediaExists: boolean;
}

// ---------------------------------------------------------------- options

export interface TranscriptionOptions {
  model: string;
  device: 'auto' | 'cpu' | 'cuda';
  computeType?: string;
  language: string | null;
  task?: 'transcribe' | 'translate';
  beamSize?: number;
  vadFilter: boolean;
  vadMinSilenceMs?: number;
  wordTimestamps?: boolean;
  initialPrompt?: string | null;
  diarize?: boolean;
}

export interface SegmentationOptions {
  maxCharsPerLine: number;
  maxLines: number;
  targetCps: number;
  maxCps?: number;
  minDurationMs?: number;
  maxDurationMs?: number;
  pauseBreakMs?: number;
  splitOnSentence?: boolean;
  oneSentencePerCue?: boolean;
}

export interface EnhancementOptions {
  restorePunctuation: boolean;
  fixCapitalization: boolean;
  removeFillers: boolean;
  removeHedges?: boolean;
  fixGrammar: boolean;
  formalize?: boolean;
  collapseRepeats?: boolean;
  smartQuotes?: boolean;
  useModel?: boolean;
  glossary?: Record<string, string>;
}

export interface RenderOptions {
  presetName?: string;
  encoder: string;
  allowHardware: boolean;
  codec?: 'h264' | 'hevc' | 'vp9';
  crf?: number;
  bitrateKbps?: number;
  preset?: string;
  audio: 'copy' | 'aac' | 'none';
  maxHeight?: number | null;
  aspect?: '9:16' | '1:1' | null;
  suffix?: string;
  outputDir?: string | null;
}

export interface RenderPreset {
  name: string;
  description: string;
  codec: string;
  crf: number;
  bitrateKbps: number;
  preset: string;
  audio: string;
  maxHeight?: number;
  aspect?: string;
}

export interface BurnPlan {
  encoder: string;
  hardware: boolean;
  codec: string;
  outputPath: string;
  outputWidth: number;
  outputHeight: number;
  audio: string;
  crf: number;
  bitrateKbps: number;
  preset: string;
  estimatedSeconds: number | null;
  ffmpegArgs: string[];
}

// ---------------------------------------------------------------- jobs

export type JobStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';
export type JobType =
  | 'probe'
  | 'extract_audio'
  | 'waveform'
  | 'transcribe'
  | 'enhance'
  | 'export_subtitles'
  | 'render'
  | 'batch_item';

export interface Job {
  id: string;
  project_id: string | null;
  batch_id: string | null;
  type: JobType;
  status: JobStatus;
  progress: number;
  stage: string | null;
  message: string | null;
  payload_json: Record<string, unknown>;
  result_json: Record<string, unknown> | null;
  error_json: ApiError | null;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
}

export interface JobEvent {
  ts: string;
  level: 'info' | 'warn' | 'error';
  stage: string | null;
  progress: number | null;
  message: string | null;
}

export interface BatchItem {
  id: string;
  batch_id: string;
  media_path: string;
  project_id: string | null;
  job_id: string | null;
  position: number;
  status: JobStatus;
  output_path: string | null;
  error_json: ApiError | null;
  job_status?: JobStatus;
  progress?: number;
  stage?: string | null;
}

export interface Batch {
  id: string;
  name: string;
  operation: 'transcribe' | 'burn' | 'transcribe_and_burn' | 'export';
  options_json: Record<string, unknown>;
  status: string;
  created_at: string;
  finished_at: string | null;
  items: BatchItem[];
  progress: number;
}

export interface ExportRecord {
  id: string;
  project_id: string | null;
  track_id: string | null;
  kind: 'srt' | 'vtt' | 'ass' | 'mp4';
  path: string;
  size_bytes: number | null;
  created_at: string;
  exists: boolean;
}

// ---------------------------------------------------------------- system

export interface AsrModel {
  name: string;
  repo: string;
  parameters: string;
  diskMb: number;
  ramGb: number;
  vramGb: number;
  relativeSpeed: number;
  accuracy: string;
  recommendedFor: string;
  installed: boolean;
  path: string | null;
  bytes: number | null;
}

export interface AsrDevice {
  id: 'cpu' | 'cuda';
  label: string;
  available: boolean;
  deviceCount?: number;
  computeTypes: string[];
  note?: string | null;
}

export interface EncoderInfo {
  name: string;
  label: string;
  vendor: string;
  codec: string;
  available: boolean;
  hardware: boolean;
  verified?: boolean;
}

export interface Capabilities {
  version: string;
  platform: { system: string; release: string; machine: string; python: string; cpuCount: number | null };
  paths: { dataDir: string; modelsDir: string; cacheDir: string; logsDir: string; database: string };
  disk: { totalGb: number; freeGb: number };
  tools: Record<'ffmpeg' | 'ffprobe', { path: string | null; available: boolean; version: string | null }>;
  encoders: EncoderInfo[];
  asr: { installed: boolean; version: string | null; error: string | null; devices: AsrDevice[]; models: AsrModel[] };
  diarization: {
    pyannote: { installed: boolean; note: string };
    builtin: { available: boolean; note: string };
  };
  punctuationModel: { name: string; installed: boolean; loaded: boolean; note: string };
  fonts: string[];
  stylePresets: string[];
}

// ---------------------------------------------------------------- events

export type BackendEvent =
  | { seq: number; type: 'hello' }
  | { seq: number; type: 'job.queued' | 'job.started' | 'job.succeeded' | 'job.failed' | 'job.cancelled'; job: Job }
  | {
      seq: number;
      type: 'job.progress';
      jobId: string;
      progress: number;
      stage: string | null;
      message: string | null;
    }
  | { seq: number; type: 'batch.finished'; batchId: string; status: string };
