/**
 * The subtitle timeline.
 *
 * This is where timing is judged and fixed: the waveform shows where speech
 * actually is, the blocks show where the captions claim it is, and the
 * discrepancy is visible at a glance. Dragging a block or its edge retimes the
 * cue; the backend then renumbers and resolves any overlap the drag created.
 *
 * Drags are committed on release, not during, so a 300-pixel drag is one undo
 * step and one save rather than three hundred.
 */

import clsx from 'clsx';
import { Lock, Plus, Scissors, ZoomIn, ZoomOut } from 'lucide-react';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { IconButton } from '@/components/common/Button';
import { Badge } from '@/components/common/Controls';
import { speakerColor } from '@/lib/subtitleText';
import { clamp, formatTimecode, snapToFrame } from '@/lib/time';
import { useEditorStore } from '@/store/useEditorStore';
import { useProjectStore } from '@/store/useProjectStore';
import { WaveformCanvas } from './WaveformCanvas';

const LANE_HEIGHT = 52;
const RULER_HEIGHT = 22;
const MIN_CUE_MS = 200;

type DragMode = 'move' | 'start' | 'end';

interface DragState {
  cueId: string;
  mode: DragMode;
  originX: number;
  startMs: number;
  endMs: number;
}

export function Timeline() {
  const project = useProjectStore((state) => state.project);
  const waveform = useProjectStore((state) => state.waveform);
  const cues = useEditorStore((state) => state.cues);
  const selection = useEditorStore((state) => state.selection);
  const playheadMs = useEditorStore((state) => state.playheadMs);
  const playing = useEditorStore((state) => state.playing);
  const zoom = useEditorStore((state) => state.zoom);
  const setZoom = useEditorStore((state) => state.setZoom);
  const setPlayhead = useEditorStore((state) => state.setPlayhead);
  const select = useEditorStore((state) => state.select);
  const editTiming = useEditorStore((state) => state.editTiming);

  const scrollRef = useRef<HTMLDivElement>(null);
  const [viewport, setViewport] = useState({ width: 1200, scrollLeft: 0, height: 180 });
  const [drag, setDrag] = useState<DragState | null>(null);
  const [preview, setPreview] = useState<{ startMs: number; endMs: number } | null>(null);
  const [snap, setSnap] = useState(true);

  const durationMs = project?.media?.duration_ms ?? Math.max(10_000, ...cues.map((cue) => cue.endMs), 10_000);
  const fps = project?.media?.fps ?? null;
  const contentWidth = Math.max(600, (durationMs / 1000) * zoom);

  const msToX = useCallback((ms: number) => (ms / 1000) * zoom, [zoom]);
  const xToMs = useCallback((x: number) => (x / zoom) * 1000, [zoom]);

  useLayoutEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    const measure = () =>
      setViewport({ width: element.clientWidth, scrollLeft: element.scrollLeft, height: element.clientHeight });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    element.addEventListener('scroll', measure, { passive: true });
    return () => {
      observer.disconnect();
      element.removeEventListener('scroll', measure);
    };
  }, []);

  // Keep the playhead in view during playback, scrolling by a screenful rather
  // than centring it — a timeline that slides under a still playhead is much
  // harder to read than one that pages.
  useEffect(() => {
    if (!playing) return;
    const element = scrollRef.current;
    if (!element) return;
    const x = msToX(playheadMs);
    if (x < element.scrollLeft || x > element.scrollLeft + element.clientWidth - 80) {
      element.scrollLeft = Math.max(0, x - element.clientWidth * 0.2);
    }
  }, [playheadMs, playing, msToX]);

  const onPointerDownBlock = (cueId: string, mode: DragMode) => (event: React.PointerEvent) => {
    event.stopPropagation();
    const cue = cues.find((candidate) => candidate.id === cueId);
    if (!cue || cue.locked) return;
    select(cueId, event.ctrlKey || event.metaKey ? 'toggle' : event.shiftKey ? 'range' : 'replace');
    setDrag({ cueId, mode, originX: event.clientX, startMs: cue.startMs, endMs: cue.endMs });
    setPreview({ startMs: cue.startMs, endMs: cue.endMs });
    (event.target as HTMLElement).setPointerCapture?.(event.pointerId);
  };

  useEffect(() => {
    if (!drag) return;

    function onMove(event: PointerEvent) {
      const deltaMs = xToMs(event.clientX - drag!.originX);
      let startMs = drag!.startMs;
      let endMs = drag!.endMs;
      if (drag!.mode === 'move') {
        startMs = Math.max(0, drag!.startMs + deltaMs);
        endMs = startMs + (drag!.endMs - drag!.startMs);
      } else if (drag!.mode === 'start') {
        startMs = clamp(drag!.startMs + deltaMs, 0, drag!.endMs - MIN_CUE_MS);
      } else {
        endMs = Math.max(drag!.startMs + MIN_CUE_MS, drag!.endMs + deltaMs);
      }
      if (snap) {
        startMs = snapToFrame(startMs, fps);
        endMs = snapToFrame(endMs, fps);
      }
      setPreview({ startMs: Math.round(startMs), endMs: Math.round(endMs) });
    }

    function onUp() {
      const committed = preview;
      if (committed && (committed.startMs !== drag!.startMs || committed.endMs !== drag!.endMs)) {
        editTiming(drag!.cueId, committed.startMs, committed.endMs);
      }
      setDrag(null);
      setPreview(null);
    }

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp, { once: true });
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, [drag, preview, snap, fps, xToMs, editTiming]);

  const scrubTo = (event: React.MouseEvent) => {
    const element = scrollRef.current;
    if (!element) return;
    const bounds = element.getBoundingClientRect();
    const x = event.clientX - bounds.left + element.scrollLeft;
    setPlayhead(clamp(xToMs(x), 0, durationMs));
  };

  const visibleStartMs = xToMs(viewport.scrollLeft);
  const visibleEndMs = xToMs(viewport.scrollLeft + viewport.width);
  const laneTop = RULER_HEIGHT;
  const waveformHeight = Math.max(40, viewport.height - RULER_HEIGHT - LANE_HEIGHT - 4);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-8 shrink-0 items-center gap-2 border-b border-panel-750 px-2">
        <span className="field-label">Timeline</span>
        <div className="mx-2 h-4 w-px bg-panel-750" />
        <IconButton label="Zoom out" onClick={() => setZoom(zoom / 1.5)}>
          <ZoomOut className="h-3.5 w-3.5" />
        </IconButton>
        <span className="w-16 text-center font-mono text-2xs text-ink-500">{Math.round(zoom)} px/s</span>
        <IconButton label="Zoom in" onClick={() => setZoom(zoom * 1.5)}>
          <ZoomIn className="h-3.5 w-3.5" />
        </IconButton>
        <button
          type="button"
          onClick={() => setSnap((value) => !value)}
          className={clsx(
            'rounded px-2 py-0.5 text-2xs font-medium transition-colors duration-120',
            snap ? 'bg-accent-soft text-accent-hover' : 'text-ink-500 hover:text-ink-300',
          )}
          title={fps ? `Snap to frames at ${fps.toFixed(2)} fps` : 'Snap to frames (frame rate unknown)'}
        >
          Snap
        </button>
        <div className="mx-1 h-4 w-px bg-panel-750" />
        <IconButton label="Add a cue at the playhead (N)" onClick={() => useEditorStore.getState().addCueAtPlayhead()}>
          <Plus className="h-3.5 w-3.5" />
        </IconButton>
        <IconButton
          label="Split the cue at the playhead (Ctrl+Shift+S)"
          onClick={() => void useEditorStore.getState().splitAtPlayhead()}
        >
          <Scissors className="h-3.5 w-3.5" />
        </IconButton>
        <div className="ml-auto flex items-center gap-2">
          {selection.length > 1 ? <Badge tone="accent">{selection.length} selected</Badge> : null}
          <span className="font-mono text-2xs tabular-nums text-ink-400">{formatTimecode(playheadMs)}</span>
        </div>
      </div>

      <div ref={scrollRef} className="relative min-h-0 flex-1 overflow-x-auto overflow-y-hidden" onMouseDown={scrubTo}>
        <div className="relative h-full" style={{ width: contentWidth }}>
          <Ruler
            durationMs={durationMs}
            zoom={zoom}
            visibleStartMs={visibleStartMs}
            visibleEndMs={visibleEndMs}
            width={contentWidth}
          />

          <div className="absolute left-0" style={{ top: RULER_HEIGHT, width: contentWidth, height: waveformHeight }}>
            <div className="absolute" style={{ left: viewport.scrollLeft }}>
              <WaveformCanvas
                waveform={waveform}
                durationMs={durationMs}
                startMs={visibleStartMs}
                endMs={visibleEndMs}
                width={viewport.width}
                height={waveformHeight}
              />
            </div>
          </div>

          <div
            className="absolute left-0 border-t border-panel-750"
            style={{ top: laneTop + waveformHeight + 4, width: contentWidth, height: LANE_HEIGHT }}
          >
            {cues.map((cue) => {
              const isDragging = drag?.cueId === cue.id && preview;
              const startMs = isDragging ? preview!.startMs : cue.startMs;
              const endMs = isDragging ? preview!.endMs : cue.endMs;
              const left = msToX(startMs);
              const width = Math.max(4, msToX(endMs) - left);
              if (left + width < viewport.scrollLeft - 400 || left > viewport.scrollLeft + viewport.width + 400) {
                return null; // cull off-screen cues: a 2 hour file has thousands
              }
              const selected = selection.includes(cue.id!);
              const tone =
                cue.cps > 27
                  ? 'border-signal-error/70 bg-signal-error/20'
                  : cue.cps > 21
                    ? 'border-signal-warn/70 bg-signal-warn/15'
                    : 'border-accent/60 bg-accent/20';
              return (
                <div
                  key={cue.id}
                  className={clsx(
                    'cue-block group',
                    tone,
                    selected && 'ring-2 ring-accent-hover ring-offset-0',
                    cue.locked ? 'cursor-not-allowed' : 'cursor-grab active:cursor-grabbing',
                  )}
                  style={{ left, width }}
                  onPointerDown={onPointerDownBlock(cue.id!, 'move')}
                  onDoubleClick={() => {
                    setPlayhead(cue.startMs);
                    useEditorStore.getState().focusCue(cue.id);
                  }}
                  title={`${formatTimecode(cue.startMs)} → ${formatTimecode(cue.endMs)} · ${cue.cps} cps\n${cue.text}`}
                >
                  {cue.speaker ? (
                    <span
                      className="absolute left-0 top-0 h-full w-1"
                      style={{
                        backgroundColor: speakerColor(
                          cue.speaker,
                          (project?.speakers ?? []).map((speaker) => ({ label: speaker.label, color: speaker.color })),
                        ),
                      }}
                    />
                  ) : null}
                  <div className="truncate px-2 py-1 leading-tight text-ink-100">
                    {cue.locked ? <Lock className="mr-1 inline h-2.5 w-2.5 text-ink-400" /> : null}
                    {cue.text.replace(/\n/g, ' ') || <span className="text-ink-500">empty</span>}
                  </div>
                  {!cue.locked ? (
                    <>
                      <span className="drag-handle left-0" onPointerDown={onPointerDownBlock(cue.id!, 'start')} />
                      <span className="drag-handle right-0" onPointerDown={onPointerDownBlock(cue.id!, 'end')} />
                    </>
                  ) : null}
                </div>
              );
            })}
          </div>

          <div
            className="pointer-events-none absolute top-0 z-10 h-full w-px bg-signal-error"
            style={{ left: msToX(playheadMs) }}
          >
            <span className="absolute -left-1 top-0 h-2 w-2 rotate-45 bg-signal-error" />
          </div>

          {drag && preview ? (
            <div
              className="pointer-events-none absolute z-20 rounded bg-panel-950/90 px-1.5 py-0.5 font-mono text-2xs text-ink-200"
              style={{ left: msToX(preview.startMs), top: 2 }}
            >
              {formatTimecode(preview.startMs)} → {formatTimecode(preview.endMs)} (
              {((preview.endMs - preview.startMs) / 1000).toFixed(2)} s)
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

/** Time ticks, spaced so labels never collide at any zoom. */
function Ruler({
  durationMs,
  zoom,
  visibleStartMs,
  visibleEndMs,
  width,
}: {
  durationMs: number;
  zoom: number;
  visibleStartMs: number;
  visibleEndMs: number;
  width: number;
}) {
  const stepSeconds = chooseStep(zoom);
  const first = Math.floor(visibleStartMs / 1000 / stepSeconds) * stepSeconds;
  const last = Math.min(durationMs / 1000, visibleEndMs / 1000 + stepSeconds);
  const ticks: number[] = [];
  for (let second = first; second <= last; second += stepSeconds) ticks.push(second);

  return (
    <div className="absolute left-0 top-0 border-b border-panel-750 bg-panel-850" style={{ width, height: RULER_HEIGHT }}>
      {ticks.map((second) => (
        <div key={second} className="absolute top-0 h-full" style={{ left: (second / 1) * zoom }}>
          <span className="absolute left-0 top-0 h-2 w-px bg-panel-600" />
          <span className="absolute left-1 top-0.5 whitespace-nowrap font-mono text-[10px] text-ink-500">
            {formatTimecode(second * 1000, { hours: second >= 3600, millis: stepSeconds < 1 })}
          </span>
        </div>
      ))}
    </div>
  );
}

function chooseStep(pixelsPerSecond: number): number {
  const candidates = [0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600];
  const minimumPixels = 72;
  return candidates.find((step) => step * pixelsPerSecond >= minimumPixels) ?? 900;
}
