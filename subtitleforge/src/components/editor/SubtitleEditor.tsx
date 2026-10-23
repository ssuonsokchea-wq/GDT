/**
 * The cue list.
 *
 * It scrolls to follow playback, so during review the cue being spoken is
 * always the one under the cursor. Virtualisation is by windowing on the
 * visible range: a two-hour interview can hold three thousand cues, and
 * mounting three thousand textareas would cost a second of layout.
 */

import { ChevronsDown, ListPlus, Merge, Sparkles } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Button } from '@/components/common/Button';
import { Badge, EmptyState } from '@/components/common/Controls';
import { useAppStore } from '@/store/useAppStore';
import { useEditorStore } from '@/store/useEditorStore';
import { useProjectStore } from '@/store/useProjectStore';
import { CueRow } from './CueRow';

const ROW_ESTIMATE = 86;
const OVERSCAN = 8;

export function SubtitleEditor() {
  const project = useProjectStore((state) => state.project);
  const cues = useEditorStore((state) => state.cues);
  const selection = useEditorStore((state) => state.selection);
  const playheadMs = useEditorStore((state) => state.playheadMs);
  const playing = useEditorStore((state) => state.playing);
  const focusCueId = useEditorStore((state) => state.focusCueId);
  const openDialog = useAppStore((state) => state.openDialog);

  const scrollRef = useRef<HTMLDivElement>(null);
  const [range, setRange] = useState({ start: 0, end: 40 });
  const [follow, setFollow] = useState(true);

  const style = project?.settings.style;
  const maxChars = style?.maxCharsPerLine ?? 42;
  const maxLines = style?.maxLines ?? 2;
  const activeIndex = cues.findIndex((cue) => playheadMs >= cue.startMs && playheadMs <= cue.endMs);

  useLayoutEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    const measure = () => {
      const start = Math.max(0, Math.floor(element.scrollTop / ROW_ESTIMATE) - OVERSCAN);
      const visible = Math.ceil(element.clientHeight / ROW_ESTIMATE) + OVERSCAN * 2;
      setRange({ start, end: start + visible });
    };
    measure();
    element.addEventListener('scroll', measure, { passive: true });
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => {
      element.removeEventListener('scroll', measure);
      observer.disconnect();
    };
  }, [cues.length]);

  // Follow playback, but stop the moment the user scrolls away themselves.
  useEffect(() => {
    if (!follow || !playing || activeIndex < 0) return;
    const element = scrollRef.current;
    if (!element) return;
    const target = activeIndex * ROW_ESTIMATE - element.clientHeight / 3;
    element.scrollTo({ top: Math.max(0, target), behavior: 'smooth' });
  }, [activeIndex, follow, playing]);

  if (!project) {
    return <EmptyState title="No project open" message="Open a project to edit its subtitles." />;
  }

  if (cues.length === 0) {
    return (
      <EmptyState
        title="No subtitles yet"
        message="Generate them from the video's audio, or import an existing SRT, VTT or ASS file."
        action={
          <div className="flex gap-2">
            <Button
              variant="primary"
              size="sm"
              icon={<Sparkles className="h-3.5 w-3.5" />}
              disabled={!project.media}
              onClick={() => openDialog('transcribe')}
            >
              Generate subtitles
            </Button>
            <Button
              size="sm"
              icon={<ListPlus className="h-3.5 w-3.5" />}
              onClick={async () => {
                const path = await window.sf.dialog.openSubtitles();
                if (path) await useProjectStore.getState().importSubtitleFile(path);
              }}
            >
              Import file
            </Button>
          </div>
        }
      />
    );
  }

  const windowed = cues.slice(range.start, range.end);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-8 shrink-0 items-center gap-2 border-b border-panel-750 px-2">
        <span className="field-label">Cues</span>
        <Badge tone="neutral">{cues.length}</Badge>
        {selection.length > 1 ? (
          <Button
            size="sm"
            variant="ghost"
            icon={<Merge className="h-3.5 w-3.5" />}
            onClick={() => void useEditorStore.getState().mergeSelected()}
          >
            Merge {selection.length}
          </Button>
        ) : null}
        <button
          type="button"
          onClick={() => setFollow((value) => !value)}
          title="Scroll the list to follow playback"
          className={`ml-auto inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-2xs ${
            follow ? 'bg-accent-soft text-accent-hover' : 'text-ink-500 hover:text-ink-300'
          }`}
        >
          <ChevronsDown className="h-3 w-3" />
          Follow
        </button>
      </div>

      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto">
        <div style={{ height: range.start * ROW_ESTIMATE }} />
        <div className="divide-y divide-panel-800">
          {windowed.map((cue, offset) => {
            const index = range.start + offset;
            return (
              <CueRow
                key={cue.id ?? index}
                cue={cue}
                active={index === activeIndex}
                selected={selection.includes(cue.id!)}
                speakers={project.speakers}
                maxChars={maxChars}
                maxLines={maxLines}
                autoFocus={focusCueId === cue.id}
                onSelect={(mode) => useEditorStore.getState().select(cue.id, mode)}
                onSeek={() => useEditorStore.getState().setPlayhead(cue.startMs)}
                onText={(text) => useEditorStore.getState().editText(cue.id!, text)}
                onTiming={(startMs, endMs) => useEditorStore.getState().editTiming(cue.id!, startMs, endMs)}
                onSplit={(caret) => void useEditorStore.getState().splitAtCaret(cue.id!, caret)}
                onDelete={() => {
                  useEditorStore.getState().select(cue.id);
                  void useEditorStore.getState().deleteSelected();
                }}
                onLock={() => useEditorStore.getState().toggleLock(cue.id!)}
                onFit={() => useEditorStore.getState().fitDuration(cue.id!)}
                onSpeaker={(speaker) => useEditorStore.getState().setSpeaker(cue.id!, speaker)}
              />
            );
          })}
        </div>
        <div style={{ height: Math.max(0, (cues.length - range.end) * ROW_ESTIMATE) }} />
      </div>
    </div>
  );
}
