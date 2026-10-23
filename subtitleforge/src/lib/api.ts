/**
 * The HTTP client.
 *
 * Every call goes to the local backend with the launch token attached. Errors
 * arrive as a typed `ApiFailure` carrying the backend's code and hint, so the
 * UI can show "the large model needs 10 GB of VRAM" instead of "500".
 */

import type {
  AsrModel,
  Batch,
  BurnPlan,
  Capabilities,
  Cue,
  EnhancementOptions,
  ExportRecord,
  Job,
  JobEvent,
  MediaFile,
  MediaProbe,
  Project,
  ProjectSummary,
  QualityReport,
  RenderOptions,
  RenderPreset,
  SegmentationOptions,
  Speaker,
  StylePreview,
  StyleRecord,
  SubtitleStyle,
  SubtitleTrack,
  TranscriptionOptions,
  Waveform,
} from '@/types/api';
import type { BackendHandle } from '@/types/bridge';

export class ApiFailure extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly hint?: string | null,
    readonly status?: number,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'ApiFailure';
  }
}

let handle: BackendHandle | null = null;

export function setBackendHandle(next: BackendHandle | null): void {
  handle = next;
}

export function getBackendHandle(): BackendHandle | null {
  return handle;
}

function baseUrl(): string {
  if (!handle) throw new ApiFailure('backend_not_ready', 'The subtitle engine is still starting.');
  return `${handle.baseUrl}/api/v1`;
}

/** An absolute URL for an asset the backend serves — posters, frames. */
export function assetUrl(path: string, params?: Record<string, string | number>): string {
  const url = new URL(`${baseUrl()}${path}`);
  for (const [key, value] of Object.entries(params ?? {})) url.searchParams.set(key, String(value));
  // Image and video elements cannot send headers, so the token rides along as
  // a query parameter for these read-only asset routes.
  url.searchParams.set('token', handle!.token);
  return url.toString();
}

/** The preview player's source. Served by the backend so seeking works. */
export function mediaStreamUrl(mediaId: string): string {
  return assetUrl(`/media/${mediaId}/stream`);
}

export function eventStreamUrl(since?: number): string {
  const url = new URL(`${baseUrl()}/events`);
  if (since !== undefined) url.searchParams.set('since', String(since));
  url.searchParams.set('token', handle!.token);
  return url.toString();
}

async function request<T>(
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
  path: string,
  options: { body?: unknown; query?: Record<string, string | number | boolean | undefined> } = {},
): Promise<T> {
  const url = new URL(`${baseUrl()}${path}`);
  for (const [key, value] of Object.entries(options.query ?? {})) {
    if (value !== undefined) url.searchParams.set(key, String(value));
  }

  let response: Response;
  try {
    response = await fetch(url, {
      method,
      headers: {
        'X-SF-Token': handle!.token,
        ...(options.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    });
  } catch (cause) {
    throw new ApiFailure(
      'backend_unreachable',
      'The subtitle engine is not responding.',
      'It may have stopped. Restart it from Settings, or reopen the application.',
      undefined,
      { cause: String(cause) },
    );
  }

  if (response.status === 204) return undefined as T;

  const text = await response.text();
  const payload = text ? safeParse(text) : undefined;

  if (!response.ok) {
    // FastAPI wraps its own errors in `detail`; ours arrive at the top level.
    type WireError = { code: string; message: string; hint?: string; details?: Record<string, unknown> };
    const error =
      (payload as { error?: WireError })?.error ?? (payload as { detail?: { error?: WireError } })?.detail?.error;
    if (error) {
      throw new ApiFailure(error.code, error.message, error.hint, response.status, error.details);
    }
    const detail = (payload as { detail?: unknown })?.detail;
    throw new ApiFailure(
      `http_${response.status}`,
      typeof detail === 'string' ? detail : `Request failed with status ${response.status}`,
      undefined,
      response.status,
      typeof detail === 'object' && detail ? (detail as Record<string, unknown>) : undefined,
    );
  }
  return payload as T;
}

function safeParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

export const api = {
  // ---- system
  health: () => request<{ status: string; version: string }>('GET', '/health'),
  capabilities: () => request<Capabilities>('GET', '/capabilities'),
  models: () => request<{ models: AsrModel[]; devices: Capabilities['asr']['devices'] }>('GET', '/models'),
  encoders: (verify = false) =>
    request<{ encoders: Capabilities['encoders'] }>('GET', '/encoders', { query: { verify } }),
  fonts: (refresh = false) => request<{ fonts: string[] }>('GET', '/fonts', { query: { refresh } }),
  readSettings: () => request<Record<string, unknown>>('GET', '/settings'),
  writeSetting: (key: string, value: unknown) =>
    request<{ key: string; value: unknown }>('PUT', `/settings/${encodeURIComponent(key)}`, { body: { value } }),
  supportedFormats: () =>
    request<{ video: string[]; audio: Array<{ id: string; label: string }>; subtitles: string[] }>(
      'GET',
      '/media/supported',
    ),

  // ---- media
  probe: (path: string) => request<MediaProbe>('POST', '/media/probe', { body: { path } }),
  importMedia: (path: string, projectId?: string) =>
    request<MediaFile>('POST', '/media/import', { body: { path, projectId } }),
  buildWaveform: (mediaId: string, buckets = 2000) =>
    request<Job>('POST', `/media/${mediaId}/waveform`, { query: { buckets } }),
  waveform: (mediaId: string, buckets = 2000) =>
    request<Waveform>('GET', `/media/${mediaId}/waveform`, { query: { buckets } }),
  extractAudio: (mediaId: string, format: string, outputPath?: string) =>
    request<Job>('POST', `/media/${mediaId}/audio`, { body: { format, purpose: 'export', outputPath } }),
  clearMediaCache: (mediaId: string) =>
    request<{ removed: number; freedMb: number }>('DELETE', `/media/${mediaId}/cache`),

  // ---- projects
  listProjects: (includeArchived = false) =>
    request<{ projects: ProjectSummary[] }>('GET', '/projects', { query: { includeArchived } }),
  createProject: (body: { name?: string; mediaPath?: string; settings?: Record<string, unknown> }) =>
    request<Project>('POST', '/projects', { body }),
  getProject: (id: string, full = false) => request<Project>('GET', `/projects/${id}`, { query: { full } }),
  openProject: (id: string) => request<Project>('POST', `/projects/${id}/open`),
  patchProject: (
    id: string,
    patch: { name?: string; notes?: string; archived?: boolean; activeTrackId?: string; settings?: Record<string, unknown> },
  ) => request<Project>('PATCH', `/projects/${id}`, { body: patch }),
  deleteProject: (id: string) => request<{ deleted: string }>('DELETE', `/projects/${id}`),
  duplicateProject: (id: string, name?: string) =>
    request<Project>('POST', `/projects/${id}/duplicate`, { query: { name } }),
  relinkProject: (id: string, path: string) => request<Project>('POST', `/projects/${id}/relink`, { body: { path } }),
  saveBundle: (id: string, outputPath: string) =>
    request<{ path: string; sizeBytes: number }>('POST', `/projects/${id}/bundle/save`, { query: { outputPath } }),
  importBundleFile: (path: string, mediaPath?: string) =>
    request<Project>('POST', '/projects/import/file', { query: { path, mediaPath } }),
  listSpeakers: (projectId: string) => request<{ speakers: Speaker[] }>('GET', `/projects/${projectId}/speakers`),
  patchSpeaker: (speakerId: string, patch: { displayName?: string; color?: string }) =>
    request<Speaker>('PATCH', `/speakers/${speakerId}`, { body: patch }),

  // ---- tracks and cues
  createTrack: (body: { projectId: string; name?: string; language?: string; source?: string }) =>
    request<SubtitleTrack>('POST', '/tracks', { body }),
  getTrack: (id: string, withCues = false, withWords = false) =>
    request<SubtitleTrack>('GET', `/tracks/${id}`, { query: { withCues, withWords } }),
  patchTrack: (id: string, patch: { name?: string; language?: string; enhanced?: boolean }) =>
    request<SubtitleTrack>('PATCH', `/tracks/${id}`, { body: patch }),
  deleteTrack: (id: string) => request<{ deleted: string }>('DELETE', `/tracks/${id}`),
  listCues: (trackId: string, withWords = false) =>
    request<{ trackId: string; cues: Cue[] }>('GET', `/tracks/${trackId}/cues`, { query: { withWords } }),
  replaceCues: (trackId: string, cues: Array<Partial<Cue>>, label?: string) =>
    request<{ cues: Cue[] }>('PUT', `/tracks/${trackId}/cues`, { body: { cues, label } }),
  patchCue: (trackId: string, cueId: string, patch: Partial<Cue>) =>
    request<{ cues: Cue[] }>('PATCH', `/tracks/${trackId}/cues/${cueId}`, { body: patch }),
  deleteCue: (trackId: string, cueId: string) =>
    request<{ cues: Cue[] }>('DELETE', `/tracks/${trackId}/cues/${cueId}`),
  splitCue: (trackId: string, cueId: string, at: { atMs?: number; atChar?: number }) =>
    request<{ cues: Cue[] }>('POST', `/tracks/${trackId}/cues/${cueId}/split`, { body: at }),
  mergeCues: (trackId: string, cueIds: string[], separator = ' ') =>
    request<{ cues: Cue[] }>('POST', `/tracks/${trackId}/cues/merge`, { body: { cueIds, separator } }),
  shiftTrack: (trackId: string, deltaMs: number, fromMs = 0) =>
    request<{ cues: Cue[] }>('POST', `/tracks/${trackId}/shift`, { body: { deltaMs, fromMs } }),
  resegment: (trackId: string, segmentation: Partial<SegmentationOptions>) =>
    request<{ cues: Cue[] }>('POST', `/tracks/${trackId}/resegment`, { body: { segmentation } }),
  quality: (trackId: string) => request<QualityReport>('GET', `/tracks/${trackId}/quality`),
  revisions: (trackId: string) =>
    request<{ revisions: Array<{ id: number; created_at: string; label: string | null }> }>(
      'GET',
      `/tracks/${trackId}/revisions`,
    ),
  previewTrack: (trackId: string, format: 'srt' | 'vtt' | 'ass') =>
    request<{ format: string; text: string; truncated: boolean }>('GET', `/tracks/${trackId}/preview`, {
      query: { format },
    }),

  // ---- pipelines
  importSubtitles: (body: { projectId: string; path: string; name?: string; language?: string }) =>
    request<{ track: SubtitleTrack; cueCount: number }>('POST', '/subtitles/import', { body }),
  transcribe: (body: {
    projectId: string;
    trackName?: string;
    enhance?: boolean;
    diarize?: boolean;
    maxSpeakers?: number;
    transcription?: Partial<TranscriptionOptions>;
    segmentation?: Partial<SegmentationOptions>;
    enhancement?: Partial<EnhancementOptions>;
  }) => request<Job>('POST', '/transcribe', { body }),
  enhance: (body: { trackId: string; enhancement?: Partial<EnhancementOptions>; rewrap?: boolean }) =>
    request<Job>('POST', '/enhance', { body }),
  enhancePreview: (text: string, enhancement?: Partial<EnhancementOptions>) =>
    request<{ text: string; changes: Array<{ kind: string; note: string }> }>('POST', '/enhance/preview', {
      body: { text, enhancement },
    }),
  exportSubtitles: (body: { trackId: string; format: 'srt' | 'vtt' | 'ass'; outputPath?: string; includeSpeakers?: boolean }) =>
    request<Job>('POST', '/export/subtitles', { body }),
  render: (body: { trackId: string; outputPath?: string; render?: Partial<RenderOptions>; style?: Partial<SubtitleStyle> }) =>
    request<Job>('POST', '/render', { body }),
  renderPlan: (body: { trackId: string; outputPath?: string; render?: Partial<RenderOptions>; style?: Partial<SubtitleStyle> }) =>
    request<BurnPlan>('POST', '/render/plan', { body }),
  listExports: (projectId?: string) =>
    request<{ exports: ExportRecord[] }>('GET', '/exports', { query: { projectId } }),

  // ---- styles
  listStyles: (projectId?: string) =>
    request<{ styles: StyleRecord[]; defaults: SubtitleStyle }>('GET', '/styles', { query: { projectId } }),
  saveStyle: (body: { name: string; projectId?: string; payload: Partial<SubtitleStyle> }) =>
    request<{ id: string; name: string; payload: SubtitleStyle }>('POST', '/styles', { body }),
  deleteStyle: (id: string) => request<{ deleted: string }>('DELETE', `/styles/${id}`),
  stylePreview: (style: Partial<SubtitleStyle>, containerHeight = 1080) =>
    request<StylePreview>('POST', '/styles/preview', { body: style, query: { containerHeight } }),
  renderPresets: () =>
    request<{ presets: RenderPreset[]; defaults: RenderOptions }>('GET', '/render-presets'),

  // ---- jobs and batches
  listJobs: (projectId?: string, status?: string) =>
    request<{ jobs: Job[] }>('GET', '/jobs', { query: { projectId, status } }),
  getJob: (id: string) => request<Job>('GET', `/jobs/${id}`),
  jobEvents: (id: string) => request<{ events: JobEvent[] }>('GET', `/jobs/${id}/events`),
  cancelJob: (id: string) => request<Job>('POST', `/jobs/${id}/cancel`),
  createBatch: (body: {
    name?: string;
    operation: Batch['operation'];
    paths: string[];
    options?: Record<string, unknown>;
  }) => request<Batch>('POST', '/batches', { body }),
  listBatches: () => request<{ batches: Batch[] }>('GET', '/batches'),
  getBatch: (id: string) => request<Batch>('GET', `/batches/${id}`),
  cancelBatch: (id: string) => request<Batch>('POST', `/batches/${id}/cancel`),
};

export type Api = typeof api;
