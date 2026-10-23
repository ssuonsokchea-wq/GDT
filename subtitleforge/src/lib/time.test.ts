import { describe, expect, it } from 'vitest';
import {
  formatBytes,
  formatDuration,
  formatEstimate,
  formatResolution,
  formatTimecode,
  msToFrames,
  parseTimecode,
  snapToFrame,
} from './time';

describe('formatTimecode', () => {
  it('pads every field', () => {
    expect(formatTimecode(0)).toBe('00:00:00.000');
    expect(formatTimecode(1)).toBe('00:00:00.001');
    expect(formatTimecode(61_234)).toBe('00:01:01.234');
    expect(formatTimecode(3_723_456)).toBe('01:02:03.456');
  });

  it('can drop hours and milliseconds', () => {
    expect(formatTimecode(61_234, { hours: false, millis: false })).toBe('01:01');
  });

  it('never shows a negative time', () => {
    expect(formatTimecode(-10)).toBe('00:00:00.000');
  });
});

describe('parseTimecode', () => {
  it('accepts the formats a user types', () => {
    expect(parseTimecode('12')).toBe(12_000);
    expect(parseTimecode('1:23')).toBe(83_000);
    expect(parseTimecode('1:23.5')).toBe(83_500);
    expect(parseTimecode('00:01:23,450')).toBe(83_450);
  });

  it('round-trips with the formatter', () => {
    for (const ms of [0, 999, 1000, 61_001, 3_599_999]) {
      expect(parseTimecode(formatTimecode(ms))).toBe(ms);
    }
  });

  it('returns null rather than zero for nonsense', () => {
    expect(parseTimecode('')).toBeNull();
    expect(parseTimecode('soon')).toBeNull();
    expect(parseTimecode('1:2:3:4')).toBeNull();
  });
});

describe('formatDuration', () => {
  it('omits the hour when there is none', () => {
    expect(formatDuration(83_000)).toBe('1:23');
    expect(formatDuration(3_723_000)).toBe('1:02:03');
  });

  it('handles nothing gracefully', () => {
    expect(formatDuration(null)).toBe('0:00');
    expect(formatDuration(0)).toBe('0:00');
  });
});

describe('formatEstimate', () => {
  it('scales its unit to the magnitude', () => {
    expect(formatEstimate(45)).toBe('45 s');
    expect(formatEstimate(134)).toBe('2 min 14 s');
    expect(formatEstimate(7_200)).toBe('2 h 0 min');
  });

  it('says so when it does not know', () => {
    expect(formatEstimate(null)).toBe('unknown');
  });
});

describe('frame snapping', () => {
  it('lands on a real frame boundary', () => {
    expect(snapToFrame(1010, 25)).toBe(1000);
    expect(snapToFrame(1030, 25)).toBe(1040);
  });

  it('is a no-op without a frame rate', () => {
    expect(snapToFrame(1013, null)).toBe(1013);
  });

  it('counts frames from milliseconds', () => {
    expect(msToFrames(1000, 25)).toBe(25);
    expect(msToFrames(1000, 29.97)).toBe(30);
  });
});

describe('human readable sizes', () => {
  it('picks a sensible unit', () => {
    expect(formatBytes(900)).toBe('900 B');
    expect(formatBytes(2048)).toBe('2.0 KB');
    expect(formatBytes(5 * 1024 * 1024)).toBe('5.0 MB');
    expect(formatBytes(12 * 1024 ** 3)).toBe('12 GB');
  });
});

describe('formatResolution', () => {
  it('adds the shorthand people say out loud', () => {
    expect(formatResolution(3840, 2160)).toBe('3840x2160 (4K)');
    expect(formatResolution(1920, 1080)).toBe('1920x1080 (1080p)');
    // Vertical footage is named by its short side, as people describe it.
    expect(formatResolution(1080, 1920)).toBe('1080x1920 (1080p)');
    expect(formatResolution(null, null)).toBe('unknown');
  });
});
