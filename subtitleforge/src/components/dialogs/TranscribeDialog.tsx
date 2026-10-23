/**
 * Generate subtitles.
 *
 * The dialog's job is to let the user make one decision well: which model.
 * That choice is a trade between accuracy, speed and memory, so each model
 * states its size, what it needs, and roughly how long this specific video
 * will take on this specific machine — the number the user actually wants.
 */

import clsx from 'clsx';
import { AlertTriangle, Cpu, HardDriveDownload, Sparkles, Zap } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Button } from '@/components/common/Button';
import { Badge, Field, Select, Toggle } from '@/components/common/Controls';
import { Modal } from '@/components/common/Modal';
import { api } from '@/lib/api';
import { formatEstimate } from '@/lib/time';
import { useAppStore } from '@/store/useAppStore';
import { useProjectStore } from '@/store/useProjectStore';

export function TranscribeDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const project = useProjectStore((state) => state.project);
  const capabilities = useAppStore((state) => state.capabilities);
  const notify = useAppStore((state) => state.notify);
  const reportError = useAppStore((state) => state.reportError);

  const settings = project?.settings.transcription;
  const [model, setModel] = useState(settings?.model ?? 'small');
  const [device, setDevice] = useState<'auto' | 'cpu' | 'cuda'>(settings?.device ?? 'auto');
  const [language, setLanguage] = useState(settings?.language ?? 'en');
  const [vad, setVad] = useState(settings?.vadFilter ?? true);
  const [enhance, setEnhance] = useState(true);
  const [diarize, setDiarize] = useState(false);
  const [prompt, setPrompt] = useState('');
  const [starting, setStarting] = useState(false);

  const models = capabilities?.asr.models ?? [];
  const devices = capabilities?.asr.devices ?? [];
  const cuda = devices.find((entry) => entry.id === 'cuda');
  const chosen = models.find((entry) => entry.name === model);
  const whisperInstalled = capabilities?.asr.installed ?? false;
  const durationMs = project?.media?.duration_ms ?? 0;

  /**
   * How long this will take.
   *
   * Whisper's relative speeds are stable; the absolute figure is not, so this
   * is calibrated from one measured point — the small model transcribing at
   * roughly 6x realtime on a modern four-core CPU — and scaled from there. It
   * is presented as an estimate and labelled as one.
   */
  const estimateSeconds = useMemo(() => {
    if (!durationMs || !chosen) return null;
    const useGpu = device === 'cuda' || (device === 'auto' && cuda?.available);
    const baseline = 6; // small, on CPU
    const speed = (chosen.relativeSpeed / 6) * baseline * (useGpu ? 8 : 1);
    return Math.max(5, Math.round(durationMs / 1000 / Math.max(0.05, speed)));
  }, [durationMs, chosen, device, cuda?.available]);

  const start = async () => {
    if (!project) return;
    setStarting(true);
    try {
      await useProjectStore.getState().updateSettings({
        transcription: { model, device, language: language || null, vadFilter: vad },
      });
      await api.transcribe({
        projectId: project.id,
        enhance,
        diarize,
        transcription: {
          model,
          device,
          language: language === 'auto' ? null : language,
          vadFilter: vad,
          initialPrompt: prompt.trim() || null,
        },
      });
      notify({
        kind: 'info',
        title: 'Generating subtitles',
        message: `${model} on ${device === 'auto' ? (cuda?.available ? 'GPU' : 'CPU') : device}. Progress is in the status bar; you can keep working.`,
      });
      onClose();
    } catch (error) {
      reportError(error, 'Could not start transcription');
    } finally {
      setStarting(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Generate subtitles"
      description="Speech recognition runs on this machine with Faster-Whisper. Nothing is uploaded."
      width="lg"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            icon={<Sparkles className="h-3.5 w-3.5" />}
            loading={starting}
            disabled={!project?.media || !chosen?.installed || !whisperInstalled}
            onClick={() => void start()}
          >
            Generate
          </Button>
        </>
      }
    >
      {!whisperInstalled ? (
        <Notice
          tone="error"
          title="Faster-Whisper is not available in the backend"
          message={capabilities?.asr.error ?? 'The Python package could not be imported.'}
          hint="Reinstall SubtitleForge, or install it into the backend environment with pip."
        />
      ) : null}

      <div className="space-y-4">
        <div>
          <h3 className="field-label mb-2">Model</h3>
          <div className="space-y-1.5">
            {models.map((entry) => {
              const selected = entry.name === model;
              return (
                <button
                  key={entry.name}
                  type="button"
                  onClick={() => setModel(entry.name)}
                  className={clsx(
                    'flex w-full items-start gap-3 rounded border px-3 py-2 text-left transition-colors duration-120',
                    selected ? 'border-accent bg-accent-soft' : 'border-panel-700 bg-panel-850 hover:border-panel-600',
                    !entry.installed && 'opacity-70',
                  )}
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-medium text-ink-100">{entry.name}</span>
                      <Badge tone="neutral">{entry.parameters}</Badge>
                      <Badge tone={entry.accuracy === 'best' ? 'ok' : 'neutral'}>{entry.accuracy}</Badge>
                      {entry.installed ? null : (
                        <Badge tone="warn" title={`Expected in ${entry.path ?? 'the models folder'}`}>
                          not installed
                        </Badge>
                      )}
                    </div>
                    <p className="mt-0.5 text-2xs leading-relaxed text-ink-500">{entry.recommendedFor}</p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="font-mono text-2xs text-ink-400">{entry.diskMb} MB</p>
                    <p className="font-mono text-2xs text-ink-500">{entry.ramGb} GB RAM</p>
                  </div>
                </button>
              );
            })}
          </div>
          {!chosen?.installed ? (
            <Notice
              tone="warn"
              title={`The ${model} model is not on this machine`}
              message="SubtitleForge never downloads models by itself, so nothing happens behind your back on a metered connection."
              hint="Settings → Models explains where to put the files, or run the bundled fetch-models script once on a connected machine."
              action={
                <Button
                  size="sm"
                  variant="ghost"
                  icon={<HardDriveDownload className="h-3 w-3" />}
                  onClick={() => void window.sf.files.openModelsFolder()}
                >
                  Open models folder
                </Button>
              }
            />
          ) : null}
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Run on" hint={cuda?.available ? undefined : (cuda?.note ?? undefined)}>
            <Select
              value={device}
              onChange={setDevice}
              options={[
                { value: 'auto', label: cuda?.available ? 'Automatic (GPU)' : 'Automatic (CPU)' },
                { value: 'cpu', label: 'CPU' },
                { value: 'cuda', label: cuda?.label ?? 'NVIDIA GPU', disabled: !cuda?.available },
              ]}
            />
          </Field>
          <Field label="Language" hint="Detection costs a few seconds and is reliable on clear speech.">
            <Select
              value={language ?? 'auto'}
              onChange={setLanguage}
              options={[
                { value: 'en', label: 'English' },
                { value: 'auto', label: 'Detect automatically' },
              ]}
            />
          </Field>
        </div>

        <div className="space-y-2.5 rounded border border-panel-750 bg-panel-850 p-3">
          <Toggle
            label="Skip silence"
            checked={vad}
            onChange={setVad}
            hint="Voice activity detection. Faster on sparse audio, and it stops the model inventing speech over music."
          />
          <Toggle
            label="Enhance the text"
            checked={enhance}
            onChange={setEnhance}
            hint="Restore punctuation and capitalisation, remove fillers, fix the spellings that are always wrong."
          />
          <Toggle
            label="Identify speakers"
            checked={diarize}
            onChange={setDiarize}
            hint={
              capabilities?.diarization.pyannote.installed
                ? 'Using pyannote, installed on this machine.'
                : 'Built-in estimate from pauses and voice texture. Good for two clear voices; check the result before you rely on it.'
            }
          />
        </div>

        <Field
          label="Names and jargon (optional)"
          hint="Words the model should expect. A comma-separated list biases the decoder towards them: brand names, people, technical terms."
        >
          <textarea
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            rows={2}
            placeholder="SubtitleForge, libass, Phnom Penh, Dr. Sokha"
            className="selectable w-full resize-none rounded border border-panel-700 bg-panel-850 px-2 py-1.5 text-xs text-ink-100 placeholder:text-ink-500 focus:border-accent focus:outline-none"
          />
        </Field>

        <div className="flex items-center gap-4 rounded border border-panel-750 bg-panel-850 px-3 py-2 text-2xs">
          <span className="flex items-center gap-1.5 text-ink-300">
            {device === 'cpu' || (device === 'auto' && !cuda?.available) ? (
              <Cpu className="h-3.5 w-3.5" />
            ) : (
              <Zap className="h-3.5 w-3.5 text-signal-ok" />
            )}
            Estimated {formatEstimate(estimateSeconds)}
          </span>
          <span className="text-ink-500">
            for {formatEstimate(durationMs / 1000)} of video. An estimate, not a promise — the first run also loads
            the model.
          </span>
        </div>
      </div>
    </Modal>
  );
}

export function Notice({
  tone,
  title,
  message,
  hint,
  action,
}: {
  tone: 'warn' | 'error' | 'info';
  title: string;
  message?: string;
  hint?: string;
  action?: React.ReactNode;
}) {
  const tones = {
    warn: 'border-signal-warn/40 bg-signal-warn/10 text-signal-warn',
    error: 'border-signal-error/40 bg-signal-error/10 text-signal-error',
    info: 'border-accent/40 bg-accent-soft text-accent-hover',
  } as const;
  return (
    <div className={clsx('mb-4 flex items-start gap-2.5 rounded border p-3', tones[tone])}>
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
      <div className="min-w-0 flex-1">
        <p className="text-xs font-medium">{title}</p>
        {message ? <p className="mt-0.5 text-2xs leading-relaxed text-ink-300">{message}</p> : null}
        {hint ? <p className="mt-1 text-2xs leading-relaxed text-ink-400">{hint}</p> : null}
        {action ? <div className="mt-1.5">{action}</div> : null}
      </div>
    </div>
  );
}
