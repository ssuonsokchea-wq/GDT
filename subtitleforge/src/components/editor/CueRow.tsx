/**
 * One cue in the editor list.
 *
 * The row is the unit of work: timecodes you can type into, a textarea that
 * grows, a reading-speed readout that updates as you type, and the four
 * operations a captioner reaches for — split, merge, fit, lock.
 */

import clsx from 'clsx';
import { Crosshair, Lock, LockOpen, Scissors, Trash2, Wand2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { IconButton } from '@/components/common/Button';
import { charsPerSecond, exceedsLineLimits, readingSpeedLevel } from '@/lib/subtitleText';
import { formatTimecode, parseTimecode } from '@/lib/time';
import type { Cue, Speaker } from '@/types/api';

interface Props {
  cue: Cue;
  active: boolean;
  selected: boolean;
  speakers: Speaker[];
  maxChars: number;
  maxLines: number;
  autoFocus?: boolean;
  onSelect: (mode: 'replace' | 'toggle' | 'range') => void;
  onSeek: () => void;
  onText: (text: string) => void;
  onTiming: (startMs: number, endMs: number) => void;
  onSplit: (caret: number) => void;
  onDelete: () => void;
  onLock: () => void;
  onFit: () => void;
  onSpeaker: (speaker: string | null) => void;
}

export function CueRow({
  cue,
  active,
  selected,
  speakers,
  maxChars,
  maxLines,
  autoFocus,
  onSelect,
  onSeek,
  onText,
  onTiming,
  onSplit,
  onDelete,
  onLock,
  onFit,
  onSpeaker,
}: Props) {
  const textRef = useRef<HTMLTextAreaElement>(null);
  const [draft, setDraft] = useState(cue.text);

  // Keep the textarea in step with external changes (undo, enhancement,
  // resegmentation) without fighting the user while they type.
  useEffect(() => {
    if (document.activeElement !== textRef.current) setDraft(cue.text);
  }, [cue.text]);

  useEffect(() => {
    if (autoFocus) textRef.current?.focus();
  }, [autoFocus]);

  const cps = charsPerSecond(draft, cue.endMs - cue.startMs);
  const level = readingSpeedLevel(cps);
  const overLimits = exceedsLineLimits(draft, maxChars, maxLines);

  return (
    <div
      onMouseDown={(event) =>
        onSelect(event.ctrlKey || event.metaKey ? 'toggle' : event.shiftKey ? 'range' : 'replace')
      }
      className={clsx(
        'group border-l-2 px-3 py-2 transition-colors duration-120',
        active ? 'border-l-accent bg-accent-soft' : selected ? 'border-l-accent-muted bg-panel-850' : 'border-l-transparent hover:bg-panel-850/60',
      )}
    >
      <div className="flex items-center gap-2">
        <span className="w-7 shrink-0 text-right font-mono text-2xs text-ink-500">{cue.idx}</span>
        <TimecodeInput value={cue.startMs} onCommit={(ms) => onTiming(ms, cue.endMs)} label="Start" />
        <span className="text-ink-600">→</span>
        <TimecodeInput value={cue.endMs} onCommit={(ms) => onTiming(cue.startMs, ms)} label="End" />
        <span className="font-mono text-2xs text-ink-500">{((cue.endMs - cue.startMs) / 1000).toFixed(2)}s</span>

        <span
          className={clsx(
            'ml-auto font-mono text-2xs tabular-nums',
            level === 'error' ? 'text-signal-error' : level === 'warn' ? 'text-signal-warn' : 'text-ink-500',
          )}
          title="Characters per second. Above 21 is fast, above 27 is too fast to read."
        >
          {cps} cps
        </span>

        <div className="flex shrink-0 items-center opacity-0 transition-opacity duration-120 group-hover:opacity-100 focus-within:opacity-100">
          <IconButton label="Move the playhead here" onClick={onSeek}>
            <Crosshair className="h-3.5 w-3.5" />
          </IconButton>
          <IconButton
            label="Split at the cursor"
            onClick={() => onSplit(textRef.current?.selectionStart ?? Math.floor(draft.length / 2))}
          >
            <Scissors className="h-3.5 w-3.5" />
          </IconButton>
          <IconButton label="Give this cue the time its text needs" onClick={onFit}>
            <Wand2 className="h-3.5 w-3.5" />
          </IconButton>
          <IconButton label={cue.locked ? 'Unlock' : 'Lock against edits'} onClick={onLock}>
            {cue.locked ? <Lock className="h-3.5 w-3.5 text-signal-warn" /> : <LockOpen className="h-3.5 w-3.5" />}
          </IconButton>
          <IconButton label="Delete this cue" onClick={onDelete} className="hover:text-signal-error">
            <Trash2 className="h-3.5 w-3.5" />
          </IconButton>
        </div>
      </div>

      <div className="mt-1.5 flex items-start gap-2">
        {speakers.length > 0 ? (
          <select
            value={cue.speaker ?? ''}
            onChange={(event) => onSpeaker(event.target.value || null)}
            className="mt-0.5 h-6 w-24 shrink-0 rounded border border-panel-700 bg-panel-850 px-1 text-2xs text-ink-300"
            title="Speaker"
          >
            <option value="">—</option>
            {speakers.map((speaker) => (
              <option key={speaker.id} value={speaker.label}>
                {speaker.display_name ?? speaker.label}
              </option>
            ))}
          </select>
        ) : null}
        <textarea
          ref={textRef}
          value={draft}
          readOnly={cue.locked}
          rows={Math.min(4, Math.max(1, draft.split('\n').length))}
          onChange={(event) => {
            setDraft(event.target.value);
            onText(event.target.value);
          }}
          onKeyDown={(event) => {
            // Enter adds the line break captions need; Shift+Enter splits the
            // cue at the cursor, which is the operation you want far more often
            // than a third line.
            if (event.key === 'Enter' && event.shiftKey) {
              event.preventDefault();
              onSplit(event.currentTarget.selectionStart);
            }
          }}
          className={clsx(
            'selectable min-h-0 w-full resize-none rounded border bg-panel-850 px-2 py-1 text-xs leading-snug text-ink-100',
            'focus:border-accent focus:outline-none',
            overLimits ? 'border-signal-warn/50' : 'border-panel-700',
            cue.locked && 'opacity-60',
          )}
          placeholder="Caption text"
          spellCheck
        />
      </div>

      {overLimits ? (
        <p className="mt-1 pl-9 text-2xs text-signal-warn">
          Over the {maxChars}-character, {maxLines}-line limit for this style.
        </p>
      ) : null}
    </div>
  );
}

/**
 * A timecode you can type into.
 *
 * It accepts `12`, `1:23`, `1:23.5` and `00:01:23,450`, commits on blur or
 * Enter, and reverts on Escape — the behaviour of every timecode field in a
 * professional editor, and the reason users trust typing over dragging for
 * precise work.
 */
function TimecodeInput({
  value,
  onCommit,
  label,
}: {
  value: number;
  onCommit: (ms: number) => void;
  label: string;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const text = draft ?? formatTimecode(value);

  return (
    <input
      value={text}
      aria-label={label}
      onChange={(event) => setDraft(event.target.value)}
      onFocus={(event) => event.currentTarget.select()}
      onBlur={() => {
        if (draft === null) return;
        const parsed = parseTimecode(draft);
        setDraft(null);
        if (parsed !== null && parsed !== value) onCommit(parsed);
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter') event.currentTarget.blur();
        if (event.key === 'Escape') {
          setDraft(null);
          event.currentTarget.blur();
        }
        // Arrow keys nudge by a tenth of a second, or a hundredth with Shift.
        if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
          event.preventDefault();
          const step = (event.shiftKey ? 10 : 100) * (event.key === 'ArrowUp' ? 1 : -1);
          setDraft(null);
          onCommit(Math.max(0, value + step));
        }
      }}
      className={clsx(
        'selectable w-[7.2rem] shrink-0 rounded border border-transparent bg-transparent px-1 py-0.5',
        'font-mono text-2xs tabular-nums text-ink-300 hover:border-panel-700 focus:border-accent focus:bg-panel-850 focus:text-ink-100 focus:outline-none',
      )}
    />
  );
}
