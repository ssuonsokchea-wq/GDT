/**
 * The status bar.
 *
 * It answers the three questions a user has during a long job: what is
 * running, how far along is it, and can I stop it. Everything else here is
 * context they can glance at — model, device, reading speed, free disk.
 */

import clsx from 'clsx';
import { Cpu, Gauge, HardDrive, Radio, X, Zap } from 'lucide-react';
import { Button } from '@/components/common/Button';
import { ProgressBar } from '@/components/common/Controls';
import { useAppStore } from '@/store/useAppStore';
import { useEditorStore } from '@/store/useEditorStore';
import { jobLabel, useJobStore } from '@/store/useJobStore';
import { useProjectStore } from '@/store/useProjectStore';

export function StatusBar() {
  const capabilities = useAppStore((state) => state.capabilities);
  const streamConnected = useAppStore((state) => state.streamConnected);
  const project = useProjectStore((state) => state.project);
  const quality = useEditorStore((state) => state.quality);
  const jobs = useJobStore((state) => state.activeJobs());
  const cancel = useJobStore((state) => state.cancel);

  const current = jobs[0];
  const asr = capabilities?.asr;
  const model = project?.settings.transcription?.model ?? 'small';
  const cudaReady = asr?.devices.some((device) => device.id === 'cuda' && device.available) ?? false;

  return (
    <footer className="flex h-8 shrink-0 items-center gap-4 border-t border-panel-750 bg-panel-900 px-3 text-2xs text-ink-400">
      <div className="flex min-w-0 flex-1 items-center gap-3">
        {current ? (
          <>
            <span className="shrink-0 text-ink-200">{jobLabel(current)}</span>
            {current.stage ? <span className="shrink-0 text-ink-500">{current.stage}</span> : null}
            <ProgressBar value={current.progress} className="w-48 shrink-0" />
            <span className="w-10 shrink-0 font-mono tabular-nums">{Math.round(current.progress * 100)}%</span>
            <Button
              size="sm"
              variant="ghost"
              icon={<X className="h-3 w-3" />}
              onClick={() => void cancel(current.id)}
            >
              Stop
            </Button>
            {jobs.length > 1 ? <span className="text-ink-500">+{jobs.length - 1} queued</span> : null}
          </>
        ) : (
          <span className="truncate">
            {project?.media
              ? project.media.filename
              : 'Import a video to begin. Everything runs on this machine.'}
          </span>
        )}
      </div>

      {quality ? (
        <span
          className={clsx(
            'flex shrink-0 items-center gap-1',
            quality.counts.error > 0
              ? 'text-signal-error'
              : quality.counts.warn > 0
                ? 'text-signal-warn'
                : 'text-signal-ok',
          )}
          title="Average reading speed, and the number of cues outside the limits"
        >
          <Gauge className="h-3 w-3" />
          {quality.averageCps} cps
          {quality.counts.error + quality.counts.warn > 0
            ? ` · ${quality.counts.error + quality.counts.warn} to review`
            : ''}
        </span>
      ) : null}

      <span className="flex shrink-0 items-center gap-1" title="Speech model and the device it runs on">
        {cudaReady ? <Zap className="h-3 w-3 text-signal-ok" /> : <Cpu className="h-3 w-3" />}
        {model} · {cudaReady ? 'GPU' : 'CPU'}
      </span>

      {capabilities ? (
        <span className="flex shrink-0 items-center gap-1" title={capabilities.paths.dataDir}>
          <HardDrive className="h-3 w-3" />
          {capabilities.disk.freeGb} GB free
        </span>
      ) : null}

      <span
        className={clsx('flex shrink-0 items-center gap-1', streamConnected ? 'text-ink-500' : 'text-signal-warn')}
        title={streamConnected ? 'Receiving progress events' : 'Reconnecting to the engine'}
      >
        <Radio className="h-3 w-3" />
        {streamConnected ? 'Live' : 'Reconnecting'}
      </span>
    </footer>
  );
}
