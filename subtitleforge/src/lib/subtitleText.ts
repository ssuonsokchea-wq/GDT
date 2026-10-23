/**
 * Caption text measurements the editor needs instantly.
 *
 * The backend owns the authoritative wrapping and quality rules. These are the
 * cheap local versions used while the user is still typing: a reading-speed
 * readout that updates per keystroke cannot wait for a round trip. The
 * thresholds match `backend/subtitleforge/services/subtitles.py`, and the
 * backend's report is what an export is checked against.
 */

import type { Cue, QualitySeverity } from '@/types/api';

export const CPS_WARN = 21;
export const CPS_FAIL = 27;
export const MIN_CUE_MS = 700;
export const MAX_CUE_MS = 7000;

export function charCount(text: string): number {
  return text.replace(/\n/g, ' ').length;
}

export function charsPerSecond(text: string, durationMs: number): number {
  if (durationMs <= 0) return 0;
  return Math.round((charCount(text) / (durationMs / 1000)) * 10) / 10;
}

export function readingSpeedLevel(cps: number): QualitySeverity | 'ok' {
  if (cps > CPS_FAIL) return 'error';
  if (cps > CPS_WARN) return 'warn';
  return 'ok';
}

/** How long this text needs on screen to be readable at a given speed. */
export function comfortableDurationMs(text: string, targetCps = 17): number {
  return Math.max(MIN_CUE_MS, Math.round((charCount(text) / targetCps) * 1000));
}

export function lineLengths(text: string): number[] {
  return text.split('\n').map((line) => line.length);
}

export function exceedsLineLimits(text: string, maxChars: number, maxLines: number): boolean {
  const lines = text.split('\n');
  return lines.length > maxLines || lines.some((line) => line.length > maxChars);
}

/**
 * A quick balanced wrap for the live preview.
 *
 * Greedy first, then one rebalancing pass that moves words down while the last
 * line is the shortest. It agrees with the backend's scored search on ordinary
 * captions and is an order of magnitude cheaper, which matters when it runs on
 * every keystroke.
 */
export function wrapPreview(text: string, maxChars: number, maxLines: number): string[] {
  const words = text.replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
  if (words.length === 0) return [''];
  if (maxLines <= 1) return [words.join(' ')];

  const lines: string[][] = [[]];
  for (const word of words) {
    const current = lines[lines.length - 1]!;
    const candidate = [...current, word].join(' ');
    if (current.length === 0 || candidate.length <= maxChars) {
      current.push(word);
    } else if (lines.length < maxLines) {
      lines.push([word]);
    } else {
      current.push(word);
    }
  }

  for (let pass = 0; pass < words.length; pass += 1) {
    let moved = false;
    for (let index = 0; index < lines.length - 1; index += 1) {
      const from = lines[index]!;
      const to = lines[index + 1]!;
      if (from.length < 2) continue;
      const lastWord = from[from.length - 1]!;
      const fromLength = from.join(' ').length;
      const toLength = to.join(' ').length;
      if (fromLength > toLength + lastWord.length + 1 && toLength + lastWord.length + 1 <= maxChars) {
        to.unshift(from.pop()!);
        moved = true;
      }
    }
    if (!moved) break;
  }
  return lines.map((line) => line.join(' '));
}

/** The cue visible at a given time, or null in a gap. */
export function cueAt(cues: Cue[], timeMs: number): Cue | null {
  // Linear from a binary search start: cue lists are sorted, and this runs on
  // every animation frame during playback.
  let low = 0;
  let high = cues.length - 1;
  while (low <= high) {
    const middle = (low + high) >> 1;
    const cue = cues[middle]!;
    if (timeMs < cue.startMs) high = middle - 1;
    else if (timeMs > cue.endMs) low = middle + 1;
    else return cue;
  }
  return null;
}

export function nextCue(cues: Cue[], timeMs: number): Cue | null {
  return cues.find((cue) => cue.startMs > timeMs) ?? null;
}

export function previousCue(cues: Cue[], timeMs: number): Cue | null {
  let found: Cue | null = null;
  for (const cue of cues) {
    if (cue.endMs < timeMs) found = cue;
    else break;
  }
  return found;
}

export function totalSpeakingMs(cues: Cue[]): number {
  return cues.reduce((sum, cue) => sum + Math.max(0, cue.endMs - cue.startMs), 0);
}

export function wordCount(cues: Cue[]): number {
  return cues.reduce((sum, cue) => sum + cue.text.split(/\s+/).filter(Boolean).length, 0);
}

/** A stable colour per speaker label, so the same voice keeps its colour. */
export const SPEAKER_COLORS = ['#38BDF8', '#FB7185', '#A3E635', '#FBBF24', '#C084FC', '#2DD4BF', '#F97316', '#94A3B8'];

export function speakerColor(label: string | null | undefined, speakers: Array<{ label: string; color: string | null }>): string {
  if (!label) return '#64748B';
  const known = speakers.find((speaker) => speaker.label === label);
  if (known?.color) return known.color;
  let hash = 0;
  for (let index = 0; index < label.length; index += 1) hash = (hash * 31 + label.charCodeAt(index)) % 997;
  return SPEAKER_COLORS[hash % SPEAKER_COLORS.length]!;
}
