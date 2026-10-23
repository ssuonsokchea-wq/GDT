/**
 * The waveform.
 *
 * Drawn from the min/max peak pairs the backend computed once per file, not
 * from the audio itself: a two-hour track is 57 million samples, and the
 * reduction to a few thousand buckets is what lets this repaint at 60 frames
 * a second while the user drags.
 *
 * Only the visible window is drawn, scaled for the device pixel ratio so the
 * line is crisp on a high-density display.
 */

import { useEffect, useRef } from 'react';
import type { Waveform } from '@/types/api';

interface Props {
  waveform: Waveform | null;
  durationMs: number;
  startMs: number;
  endMs: number;
  width: number;
  height: number;
  color?: string;
  background?: string;
}

export function WaveformCanvas({
  waveform,
  durationMs,
  startMs,
  endMs,
  width,
  height,
  color = 'rgba(56, 189, 248, 0.55)',
  background = 'transparent',
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || width <= 0 || height <= 0) return;
    const ratio = window.devicePixelRatio || 1;
    canvas.width = Math.ceil(width * ratio);
    canvas.height = Math.ceil(height * ratio);
    const context = canvas.getContext('2d');
    if (!context) return;
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.clearRect(0, 0, width, height);

    if (background !== 'transparent') {
      context.fillStyle = background;
      context.fillRect(0, 0, width, height);
    }

    const middle = height / 2;
    context.strokeStyle = 'rgba(255,255,255,0.08)';
    context.beginPath();
    context.moveTo(0, middle);
    context.lineTo(width, middle);
    context.stroke();

    if (!waveform || waveform.peaks.length === 0 || endMs <= startMs) {
      context.fillStyle = 'rgba(255,255,255,0.22)';
      context.font = '11px Inter, sans-serif';
      context.fillText(waveform ? 'No audio detected' : 'Analysing audio…', 8, middle - 6);
      return;
    }

    const msPerBucket = waveform.msPerBucket || durationMs / waveform.peaks.length;
    const visibleMs = endMs - startMs;
    context.fillStyle = color;

    // One column per device-independent pixel, each taking the extremes of
    // every bucket it covers — so a quiet click in a long file is not lost to
    // sampling, as it would be if we drew one bucket per pixel.
    for (let x = 0; x < width; x += 1) {
      const columnStart = startMs + (x / width) * visibleMs;
      const columnEnd = startMs + ((x + 1) / width) * visibleMs;
      const firstBucket = Math.max(0, Math.floor(columnStart / msPerBucket));
      const lastBucket = Math.min(waveform.peaks.length - 1, Math.ceil(columnEnd / msPerBucket));
      let low = 0;
      let high = 0;
      for (let index = firstBucket; index <= lastBucket; index += 1) {
        const peak = waveform.peaks[index];
        if (!peak) continue;
        if (peak[0] < low) low = peak[0];
        if (peak[1] > high) high = peak[1];
      }
      const top = middle - high * middle * 0.94;
      const bottom = middle - low * middle * 0.94;
      context.fillRect(x, top, 1, Math.max(1, bottom - top));
    }
  }, [waveform, durationMs, startMs, endMs, width, height, color, background]);

  return <canvas ref={canvasRef} style={{ width, height }} className="block" />;
}
