import { describe, expect, it } from 'vitest';
import type { Cue } from '@/types/api';
import {
  charsPerSecond,
  comfortableDurationMs,
  cueAt,
  exceedsLineLimits,
  nextCue,
  previousCue,
  readingSpeedLevel,
  speakerColor,
  wrapPreview,
} from './subtitleText';

function cue(startMs: number, endMs: number, text = 'x'): Cue {
  return {
    id: `c${startMs}`,
    idx: 1,
    startMs,
    endMs,
    text,
    rawText: null,
    speaker: null,
    confidence: null,
    styleOverride: null,
    locked: false,
    cps: 0,
    words: [],
  };
}

describe('reading speed', () => {
  it('counts characters per second ignoring line breaks', () => {
    expect(charsPerSecond('abcde\nfghij', 2000)).toBe(5.5);
  });

  it('grades against the broadcast thresholds', () => {
    expect(readingSpeedLevel(15)).toBe('ok');
    expect(readingSpeedLevel(23)).toBe('warn');
    expect(readingSpeedLevel(30)).toBe('error');
  });

  it('suggests a duration that is comfortable to read', () => {
    expect(comfortableDurationMs('a'.repeat(34), 17)).toBe(2000);
    expect(comfortableDurationMs('hi', 17)).toBe(700); // never below the minimum
  });
});

describe('wrapPreview', () => {
  it('keeps short text on one line', () => {
    expect(wrapPreview('Hello there', 42, 2)).toEqual(['Hello there']);
  });

  it('balances two lines rather than filling the first', () => {
    const lines = wrapPreview('The quick brown fox jumps over the lazy dog', 26, 2);
    expect(lines).toHaveLength(2);
    expect(Math.abs(lines[0]!.length - lines[1]!.length)).toBeLessThanOrEqual(8);
  });

  it('respects a one-line limit', () => {
    expect(wrapPreview('a much longer caption than fits', 10, 1)).toHaveLength(1);
  });

  it('never splits a word', () => {
    for (const line of wrapPreview('internationalisation matters', 12, 3)) {
      expect(line).not.toMatch(/internationalisatio$/);
    }
  });

  it('reports when the limits are exceeded', () => {
    expect(exceedsLineLimits('one\ntwo\nthree', 42, 2)).toBe(true);
    expect(exceedsLineLimits('a'.repeat(50), 42, 2)).toBe(true);
    expect(exceedsLineLimits('fine', 42, 2)).toBe(false);
  });
});

describe('cue lookup', () => {
  const cues = [cue(0, 1000), cue(2000, 3000), cue(4000, 5000)];

  it('finds the cue covering a time', () => {
    expect(cueAt(cues, 2500)?.startMs).toBe(2000);
    expect(cueAt(cues, 0)?.startMs).toBe(0);
    expect(cueAt(cues, 5000)?.startMs).toBe(4000);
  });

  it('returns null inside a gap', () => {
    expect(cueAt(cues, 1500)).toBeNull();
    expect(cueAt(cues, 9000)).toBeNull();
  });

  it('steps forward and back', () => {
    expect(nextCue(cues, 1200)?.startMs).toBe(2000);
    expect(previousCue(cues, 2500)?.startMs).toBe(0);
    expect(nextCue(cues, 9000)).toBeNull();
    expect(previousCue(cues, 0)).toBeNull();
  });
});

describe('speakerColor', () => {
  it('prefers the stored colour', () => {
    expect(speakerColor('SPEAKER_00', [{ label: 'SPEAKER_00', color: '#123456' }])).toBe('#123456');
  });

  it('is stable for an unknown speaker', () => {
    expect(speakerColor('Alice', [])).toBe(speakerColor('Alice', []));
  });

  it('has a neutral colour for no speaker', () => {
    expect(speakerColor(null, [])).toBe('#64748B');
  });
});
