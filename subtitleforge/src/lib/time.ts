/**
 * Timecodes and time arithmetic for the editor.
 *
 * The timeline, the cue list and the preview all speak milliseconds; only the
 * display layer formats. Keeping the conversions here — and tested — is what
 * stops an off-by-one-frame bug from reaching an exported file.
 */

export const MS_PER_FRAME_AT_25 = 40;

/** `00:01:23.450` — the editor's reading format. */
export function formatTimecode(ms: number, options: { hours?: boolean; millis?: boolean } = {}): string {
  const { hours: showHours = true, millis: showMillis = true } = options;
  const total = Math.max(0, Math.round(ms));
  const hours = Math.floor(total / 3_600_000);
  const minutes = Math.floor((total % 3_600_000) / 60_000);
  const seconds = Math.floor((total % 60_000) / 1000);
  const millis = total % 1000;
  const parts: string[] = [];
  if (showHours || hours > 0) parts.push(String(hours).padStart(2, '0'));
  parts.push(String(minutes).padStart(2, '0'), String(seconds).padStart(2, '0'));
  const base = parts.join(':');
  return showMillis ? `${base}.${String(millis).padStart(3, '0')}` : base;
}

/** `1:23` — compact form for durations in lists. */
export function formatDuration(ms: number | null | undefined): string {
  if (!ms || ms <= 0) return '0:00';
  const total = Math.round(ms / 1000);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  if (hours > 0) return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

/** `2 min 14 s` — for estimates, where precision would be false confidence. */
export function formatEstimate(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined) return 'unknown';
  if (seconds < 60) return `${Math.max(1, Math.round(seconds))} s`;
  const minutes = Math.floor(seconds / 60);
  const rest = Math.round(seconds % 60);
  if (minutes < 60) return rest ? `${minutes} min ${rest} s` : `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  return `${hours} h ${minutes % 60} min`;
}

/** Accepts `12`, `1:23`, `1:23.4`, `00:01:23,450`. Returns null if unreadable. */
export function parseTimecode(input: string): number | null {
  const text = input.trim().replace(',', '.');
  if (text === '') return null;
  if (/^\d+(\.\d+)?$/.test(text)) return Math.round(Number(text) * 1000);
  const match = /^(?:(\d{1,3}):)?(\d{1,2}):(\d{1,2}(?:\.\d{1,3})?)$/.exec(text);
  if (!match) return null;
  const [, hours = '0', minutes = '0', seconds = '0'] = match;
  const value = Number(hours) * 3_600_000 + Number(minutes) * 60_000 + Number(seconds) * 1000;
  return Number.isFinite(value) ? Math.round(value) : null;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Snap to the nearest frame, so a dragged cue lands on a real frame boundary. */
export function snapToFrame(ms: number, fps: number | null | undefined): number {
  if (!fps || fps <= 0) return Math.round(ms);
  const frameMs = 1000 / fps;
  return Math.round(Math.round(ms / frameMs) * frameMs);
}

export function msToFrames(ms: number, fps: number | null | undefined): number {
  if (!fps || fps <= 0) return 0;
  return Math.round((ms / 1000) * fps);
}

export function formatBytes(bytes: number | null | undefined): string {
  if (!bytes || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const exponent = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  const value = bytes / 1024 ** exponent;
  return `${value >= 10 || exponent === 0 ? Math.round(value) : value.toFixed(1)} ${units[exponent]}`;
}

/**
 * `1920x1080 (1080p)` — the dimensions plus the shorthand people say.
 *
 * The shorthand comes from the smaller dimension, so vertical footage reads as
 * 1080x1920 (1080p) rather than being promoted to 1440p by its height.
 */
export function formatResolution(width: number | null, height: number | null): string {
  if (!width || !height) return 'unknown';
  const shortSide = Math.min(width, height);
  const shorthand =
    shortSide >= 2160
      ? '4K'
      : shortSide >= 1440
        ? '1440p'
        : shortSide >= 1080
          ? '1080p'
          : shortSide >= 720
            ? '720p'
            : `${shortSide}p`;
  return `${width}x${height} (${shorthand})`;
}
