/**
 * The quality report.
 *
 * Professional captioning is checked against limits before delivery: reading
 * speed, line length, minimum duration, overlaps. This panel runs those checks
 * continuously and makes each finding clickable, so fixing the list is the
 * last pass before export rather than a separate review.
 */

import clsx from 'clsx';
import { AlertCircle, AlertTriangle, CheckCircle2, Info } from 'lucide-react';
import { Button } from '@/components/common/Button';
import { Badge, EmptyState } from '@/components/common/Controls';
import { useEditorStore } from '@/store/useEditorStore';
import { useProjectStore } from '@/store/useProjectStore';
import { formatDuration } from '@/lib/time';
import type { QualitySeverity } from '@/types/api';

const ICONS: Record<QualitySeverity, typeof Info> = {
  error: AlertCircle,
  warn: AlertTriangle,
  info: Info,
};

const TONES: Record<QualitySeverity, string> = {
  error: 'text-signal-error',
  warn: 'text-signal-warn',
  info: 'text-ink-400',
};

const EXPLANATIONS: Record<string, string> = {
  reading_speed: 'Too many characters for the time on screen. Extend the cue, or cut words.',
  too_short: 'On screen too briefly to register as text. Below 700 ms a caption reads as a flash.',
  too_long: 'On screen long after the line was spoken. Not wrong, but it draws the eye.',
  line_length: 'A line longer than this style allows will wrap unpredictably on some players.',
  line_count: 'More lines than this style allows. Three lines cover a third of a 16:9 frame.',
  overlap: 'Two captions claim the same moment. Players show one, unpredictably.',
  empty: 'A cue with no text. It occupies time in the file and shows nothing.',
};

export function QualityPanel() {
  const quality = useEditorStore((state) => state.quality);
  const cues = useEditorStore((state) => state.cues);
  const setPlayhead = useEditorStore((state) => state.setPlayhead);
  const select = useEditorStore((state) => state.select);
  const project = useProjectStore((state) => state.project);

  if (!quality || cues.length === 0) {
    return <EmptyState title="Nothing to check yet" message="Generate or import subtitles first." />;
  }

  const coverage =
    project?.media?.duration_ms && project.media.duration_ms > 0
      ? Math.round((quality.speakingMs / project.media.duration_ms) * 100)
      : null;

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <section className="border-b border-panel-800 p-3">
        <h3 className="field-label mb-2">Summary</h3>
        <dl className="grid grid-cols-2 gap-x-3 gap-y-2 text-xs">
          <Stat label="Cues" value={String(quality.cueCount)} />
          <Stat
            label="Average reading speed"
            value={`${quality.averageCps} cps`}
            tone={quality.averageCps > 21 ? 'warn' : 'ok'}
          />
          <Stat label="Characters" value={quality.totalChars.toLocaleString()} />
          <Stat label="On screen" value={formatDuration(quality.speakingMs)} />
          {coverage !== null ? <Stat label="Coverage" value={`${coverage}% of the video`} /> : null}
          <Stat
            label="Findings"
            value={
              quality.counts.error + quality.counts.warn === 0
                ? 'none'
                : `${quality.counts.error} to fix, ${quality.counts.warn} to review`
            }
            tone={quality.counts.error > 0 ? 'error' : quality.counts.warn > 0 ? 'warn' : 'ok'}
          />
        </dl>
      </section>

      {quality.issues.length === 0 ? (
        <div className="flex items-start gap-2 p-4">
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-signal-ok" />
          <div>
            <p className="text-xs text-ink-200">This track passes every check.</p>
            <p className="mt-1 text-2xs leading-relaxed text-ink-500">
              Reading speed, line length, minimum duration and overlap all within the limits for the current style.
            </p>
          </div>
        </div>
      ) : (
        <ul className="divide-y divide-panel-800">
          {quality.issues.map((issue, index) => {
            const Icon = ICONS[issue.severity];
            const cue = cues.find((candidate) => candidate.idx === issue.cueIdx);
            return (
              <li key={`${issue.cueIdx}-${issue.kind}-${index}`}>
                <button
                  type="button"
                  onClick={() => {
                    if (!cue) return;
                    setPlayhead(cue.startMs);
                    select(cue.id);
                    useEditorStore.getState().focusCue(cue.id);
                  }}
                  className="w-full px-3 py-2 text-left hover:bg-panel-850"
                >
                  <div className="flex items-center gap-2">
                    <Icon className={clsx('h-3.5 w-3.5 shrink-0', TONES[issue.severity])} />
                    <span className="font-mono text-2xs text-ink-500">#{issue.cueIdx}</span>
                    <span className="truncate text-xs text-ink-200">{issue.message}</span>
                    <Badge tone={issue.severity === 'error' ? 'error' : issue.severity === 'warn' ? 'warn' : 'neutral'}>
                      {issue.kind.replace(/_/g, ' ')}
                    </Badge>
                  </div>
                  <p className="mt-1 pl-6 text-2xs leading-relaxed text-ink-500">
                    {EXPLANATIONS[issue.kind] ?? ''}
                  </p>
                  {cue ? <p className="mt-0.5 truncate pl-6 text-2xs text-ink-400">{cue.text.replace(/\n/g, ' ')}</p> : null}
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {quality.issues.some((issue) => issue.kind === 'reading_speed' || issue.kind === 'line_length') ? (
        <div className="border-t border-panel-800 p-3">
          <p className="mb-2 text-2xs leading-relaxed text-ink-500">
            Most reading-speed and line-length findings clear in one pass if the captions are re-cut to this style's
            limits, using the original word timings.
          </p>
          <Button
            size="sm"
            variant="secondary"
            full
            onClick={() =>
              void useEditorStore
                .getState()
                .resegment(project?.settings.style.maxCharsPerLine ?? 42, project?.settings.style.maxLines ?? 2)
            }
          >
            Re-cut captions to fix timing
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: 'ok' | 'warn' | 'error' }) {
  return (
    <div className="min-w-0">
      <dt className="truncate text-2xs text-ink-500">{label}</dt>
      <dd
        className={clsx(
          'truncate font-medium',
          tone === 'error' ? 'text-signal-error' : tone === 'warn' ? 'text-signal-warn' : tone === 'ok' ? 'text-signal-ok' : 'text-ink-200',
        )}
      >
        {value}
      </dd>
    </div>
  );
}
