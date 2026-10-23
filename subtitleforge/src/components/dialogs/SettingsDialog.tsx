/**
 * Settings.
 *
 * Four tabs, one question each: what does the enhancer do to my words, which
 * models are installed, what hardware can this machine use, and what is this
 * application doing with my files. The last is not an afterthought — an
 * offline tool earns trust by being specific about it.
 */

import clsx from 'clsx';
import { Cpu, FolderOpen, HardDrive, RefreshCw, Shield, Sparkles, Wand2, Zap } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button } from '@/components/common/Button';
import { Badge, Toggle } from '@/components/common/Controls';
import { Modal } from '@/components/common/Modal';
import { api } from '@/lib/api';
import { formatBytes } from '@/lib/time';
import { useAppStore } from '@/store/useAppStore';
import { useEditorStore } from '@/store/useEditorStore';
import { useProjectStore } from '@/store/useProjectStore';
import type { EnhancementOptions } from '@/types/api';

type Tab = 'enhancement' | 'models' | 'hardware' | 'privacy';

const SAMPLE = 'um so hello guys welcome back today we are talking about ai and the the api';

export function SettingsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [tab, setTab] = useState<Tab>('enhancement');

  return (
    <Modal open={open} onClose={onClose} title="Settings" width="lg" footer={<Button onClick={onClose}>Done</Button>}>
      <div className="mb-4 flex gap-1 border-b border-panel-750">
        {(
          [
            ['enhancement', 'Text enhancement', Wand2],
            ['models', 'Models', HardDrive],
            ['hardware', 'Hardware', Cpu],
            ['privacy', 'Privacy', Shield],
          ] as Array<[Tab, string, typeof Wand2]>
        ).map(([id, label, Icon]) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className={clsx(
              '-mb-px flex items-center gap-1.5 border-b-2 px-3 py-2 text-xs transition-colors duration-120',
              tab === id ? 'border-accent text-ink-100' : 'border-transparent text-ink-400 hover:text-ink-200',
            )}
          >
            <Icon className="h-3.5 w-3.5" />
            {label}
          </button>
        ))}
      </div>

      {tab === 'enhancement' ? <EnhancementSettings /> : null}
      {tab === 'models' ? <ModelSettings /> : null}
      {tab === 'hardware' ? <HardwareSettings /> : null}
      {tab === 'privacy' ? <PrivacySettings /> : null}
    </Modal>
  );
}

function EnhancementSettings() {
  const project = useProjectStore((state) => state.project);
  const trackId = useEditorStore((state) => state.trackId);
  const capabilities = useAppStore((state) => state.capabilities);
  const [options, setOptions] = useState<EnhancementOptions>(
    project?.settings.enhancement ?? {
      restorePunctuation: true,
      fixCapitalization: true,
      removeFillers: true,
      fixGrammar: true,
    },
  );
  const [sample, setSample] = useState(SAMPLE);
  const [result, setResult] = useState('');
  const [running, setRunning] = useState(false);

  // Show the effect of the current options on real text, as they change.
  useEffect(() => {
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void api
        .enhancePreview(sample, options)
        .then((response) => {
          if (!cancelled) setResult(response.text);
        })
        .catch(() => {
          if (!cancelled) setResult('');
        });
    }, 150);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [sample, options]);

  const set = (patch: Partial<EnhancementOptions>) => {
    const next = { ...options, ...patch };
    setOptions(next);
    void useProjectStore.getState().updateSettings({ enhancement: next });
  };

  return (
    <div className="space-y-4">
      <p className="text-2xs leading-relaxed text-ink-400">
        Enhancement is a rule engine, not a language model rewriting your words. Every change it makes is one of the
        kinds below, it is the same every time, and the original transcript is kept so you can compare.
      </p>

      <div className="space-y-2.5 rounded border border-panel-750 bg-panel-850 p-3">
        <Toggle
          label="Restore punctuation"
          checked={options.restorePunctuation}
          onChange={(value) => set({ restorePunctuation: value })}
          hint="Full stops at sentence ends, commas after greetings, question marks on questions."
        />
        <Toggle
          label="Sentence case"
          checked={options.fixCapitalization}
          onChange={(value) => set({ fixCapitalization: value })}
          hint="Capitals after full stops, and the right casing for names and acronyms: AI, API, YouTube, FFmpeg."
        />
        <Toggle
          label="Remove fillers"
          checked={options.removeFillers}
          onChange={(value) => set({ removeFillers: value })}
          hint='"um", "uh", "you know", and repeated words from a stutter.'
        />
        <Toggle
          label="Remove hedges"
          checked={options.removeHedges ?? false}
          onChange={(value) => set({ removeHedges: value })}
          hint='"basically", "actually", "literally". Off by default: sometimes they carry meaning.'
        />
        <Toggle
          label="Fix spellings"
          checked={options.fixGrammar}
          onChange={(value) => set({ fixGrammar: value })}
          hint="Only forms that are wrong in every context: dont, cant, alot, teh."
        />
        <Toggle
          label="Expand casual speech"
          checked={options.formalize ?? false}
          onChange={(value) => set({ formalize: value })}
          hint='"gonna" becomes "going to". Off by default: captions usually keep the speaker’s voice.'
        />
        <Toggle
          label="Typographic quotes"
          checked={options.smartQuotes ?? false}
          onChange={(value) => set({ smartQuotes: value })}
        />
        <Toggle
          label="Use the local punctuation model"
          checked={options.useModel ?? false}
          onChange={(value) => set({ useModel: value })}
          disabled={!capabilities?.punctuationModel.installed}
          hint={capabilities?.punctuationModel.note}
        />
      </div>

      <div>
        <span className="field-label">Try it</span>
        <textarea
          value={sample}
          onChange={(event) => setSample(event.target.value)}
          rows={2}
          className="selectable mt-1 w-full resize-none rounded border border-panel-700 bg-panel-850 px-2 py-1.5 font-mono text-2xs text-ink-300 focus:border-accent focus:outline-none"
        />
        <div className="mt-1.5 rounded border border-accent/30 bg-accent-soft px-2 py-1.5 text-xs text-ink-100">
          {result || <span className="text-ink-500">…</span>}
        </div>
      </div>

      {trackId ? (
        <Button
          variant="primary"
          icon={<Sparkles className="h-3.5 w-3.5" />}
          loading={running}
          onClick={async () => {
            setRunning(true);
            try {
              await useEditorStore.getState().flush();
              await api.enhance({ trackId, enhancement: options });
            } catch (error) {
              useAppStore.getState().reportError(error, 'Could not enhance the track');
            } finally {
              setRunning(false);
            }
          }}
        >
          Apply to the current track
        </Button>
      ) : null}
    </div>
  );
}

function ModelSettings() {
  const capabilities = useAppStore((state) => state.capabilities);
  const refresh = useAppStore((state) => state.refreshCapabilities);
  const models = capabilities?.asr.models ?? [];

  return (
    <div className="space-y-4">
      <p className="text-2xs leading-relaxed text-ink-400">
        SubtitleForge never downloads a model on its own. Put the CTranslate2 conversion of each Whisper model in the
        folder below, one directory per model, and it appears here. The bundled{' '}
        <code className="font-mono text-ink-300">npm run fetch-models</code> script does this once on a machine with a
        connection; after that the folder can be copied anywhere.
      </p>

      <div className="flex items-center gap-2">
        <Button size="sm" icon={<FolderOpen className="h-3.5 w-3.5" />} onClick={() => void window.sf.files.openModelsFolder()}>
          Open models folder
        </Button>
        <Button size="sm" variant="ghost" icon={<RefreshCw className="h-3.5 w-3.5" />} onClick={() => void refresh()}>
          Re-scan
        </Button>
      </div>

      <ul className="divide-y divide-panel-800 rounded border border-panel-750">
        {models.map((model) => (
          <li key={model.name} className="flex items-center gap-3 px-3 py-2">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="text-xs text-ink-100">{model.name}</span>
                {model.installed ? (
                  <Badge tone="ok">installed {model.bytes ? `· ${formatBytes(model.bytes)}` : ''}</Badge>
                ) : (
                  <Badge tone="neutral">not installed</Badge>
                )}
              </div>
              <p className="mt-0.5 truncate font-mono text-2xs text-ink-500" title={model.repo}>
                {model.repo}
              </p>
            </div>
            <div className="shrink-0 text-right text-2xs text-ink-500">
              <p>{model.diskMb} MB on disk</p>
              <p>
                {model.ramGb} GB RAM · {model.vramGb} GB VRAM
              </p>
            </div>
          </li>
        ))}
      </ul>

      <div className="rounded border border-panel-750 bg-panel-850 p-3 text-2xs leading-relaxed text-ink-400">
        <p className="mb-1 font-medium text-ink-200">Which one should I use?</p>
        <p>
          On a laptop without a discrete GPU, <strong className="text-ink-200">small</strong> is the honest default:
          close to medium's accuracy on clear speech at three times the speed. Choose{' '}
          <strong className="text-ink-200">medium</strong> for accents, crosstalk or technical vocabulary, and{' '}
          <strong className="text-ink-200">large-v3</strong> only with a 10 GB GPU — on a CPU it transcribes roughly in
          real time, so an hour of video takes an hour.
        </p>
      </div>
    </div>
  );
}

function HardwareSettings() {
  const capabilities = useAppStore((state) => state.capabilities);
  const [verifying, setVerifying] = useState(false);
  const [encoders, setEncoders] = useState(capabilities?.encoders ?? []);

  useEffect(() => {
    setEncoders(capabilities?.encoders ?? []);
  }, [capabilities?.encoders]);

  const devices = capabilities?.asr.devices ?? [];
  const tools = capabilities?.tools;

  return (
    <div className="space-y-4">
      <section>
        <h3 className="field-label mb-2">Speech recognition</h3>
        <ul className="space-y-1.5">
          {devices.map((device) => (
            <li
              key={device.id}
              className="flex items-start gap-2 rounded border border-panel-750 bg-panel-850 px-3 py-2"
            >
              {device.id === 'cuda' ? <Zap className="mt-0.5 h-3.5 w-3.5 text-ink-400" /> : <Cpu className="mt-0.5 h-3.5 w-3.5 text-ink-400" />}
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-xs text-ink-100">{device.label}</span>
                  <Badge tone={device.available ? 'ok' : 'neutral'}>{device.available ? 'available' : 'unavailable'}</Badge>
                </div>
                {device.note ? <p className="mt-0.5 text-2xs leading-relaxed text-ink-500">{device.note}</p> : null}
              </div>
            </li>
          ))}
        </ul>
      </section>

      <section>
        <div className="mb-2 flex items-center gap-2">
          <h3 className="field-label">Video encoders</h3>
          <Button
            size="sm"
            variant="ghost"
            loading={verifying}
            className="ml-auto"
            onClick={async () => {
              setVerifying(true);
              try {
                // Listing says the build supports an encoder; only a real
                // two-frame encode says the machine can run it.
                const response = await api.encoders(true);
                setEncoders(response.encoders);
              } finally {
                setVerifying(false);
              }
            }}
          >
            Test hardware encoders
          </Button>
        </div>
        <ul className="grid grid-cols-2 gap-1.5">
          {encoders.map((encoder) => (
            <li
              key={encoder.name}
              className={clsx(
                'rounded border px-2 py-1.5',
                encoder.available ? 'border-panel-700 bg-panel-850' : 'border-panel-800 bg-panel-900 opacity-60',
              )}
            >
              <div className="flex items-center gap-1.5">
                <span className="truncate text-2xs text-ink-200">{encoder.label}</span>
                {encoder.verified === true ? <Badge tone="ok">works</Badge> : null}
                {encoder.verified === false ? <Badge tone="error">refused</Badge> : null}
              </div>
              <p className="font-mono text-2xs text-ink-500">{encoder.name}</p>
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h3 className="field-label mb-2">FFmpeg</h3>
        {tools ? (
          <ul className="space-y-1.5">
            {(['ffmpeg', 'ffprobe'] as const).map((name) => (
              <li key={name} className="rounded border border-panel-750 bg-panel-850 px-3 py-2">
                <div className="flex items-center gap-2">
                  <span className="text-xs text-ink-100">{name}</span>
                  <Badge tone={tools[name].available ? 'ok' : 'error'}>
                    {tools[name].available ? 'found' : 'missing'}
                  </Badge>
                </div>
                <p className="mt-0.5 truncate font-mono text-2xs text-ink-500" title={tools[name].path ?? ''}>
                  {tools[name].version ?? tools[name].path ?? 'not on this machine'}
                </p>
              </li>
            ))}
          </ul>
        ) : null}
      </section>

      <Button
        size="sm"
        variant="ghost"
        icon={<RefreshCw className="h-3.5 w-3.5" />}
        onClick={() => void window.sf.backend.restart()}
      >
        Restart the subtitle engine
      </Button>
    </div>
  );
}

function PrivacySettings() {
  const capabilities = useAppStore((state) => state.capabilities);
  const info = useAppStore((state) => state.info);
  const project = useProjectStore((state) => state.project);

  return (
    <div className="space-y-4 text-2xs leading-relaxed text-ink-400">
      <section className="rounded border border-signal-ok/30 bg-signal-ok/5 p-3">
        <h3 className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-signal-ok">
          <Shield className="h-3.5 w-3.5" />
          This application does not use the network
        </h3>
        <ul className="ml-4 list-disc space-y-1">
          <li>Speech recognition runs locally through Faster-Whisper on your CPU or GPU.</li>
          <li>Text enhancement is a rule engine in the application, with no model call.</li>
          <li>The window loads only files inside the application; its security policy blocks every remote origin.</li>
          <li>
            The engine listens on 127.0.0.1 behind a token generated at launch, so nothing else on your machine can
            drive it.
          </li>
          <li>Model downloading is disabled in the engine's own environment, not merely avoided in our code.</li>
        </ul>
      </section>

      <section>
        <h3 className="field-label mb-1.5">Where your work is kept</h3>
        <dl className="space-y-1">
          {capabilities
            ? (
                [
                  ['Projects database', capabilities.paths.database],
                  ['Models', capabilities.paths.modelsDir],
                  ['Cache (audio, waveforms, posters)', capabilities.paths.cacheDir],
                  ['Logs', capabilities.paths.logsDir],
                ] as Array<[string, string]>
              ).map(([label, path]) => (
                <div key={label}>
                  <dt className="text-ink-500">{label}</dt>
                  <dd className="selectable break-all font-mono text-ink-300">{path}</dd>
                </div>
              ))
            : null}
        </dl>
        <p className="mt-2">
          Your videos are never copied. A project stores the path to the file where you put it, which is why moving a
          video needs a relink rather than a re-import.
        </p>
      </section>

      <section className="flex flex-wrap gap-2">
        <Button size="sm" variant="ghost" onClick={() => void window.sf.files.openLogs()}>
          Open logs folder
        </Button>
        {project?.media ? (
          <Button
            size="sm"
            variant="ghost"
            onClick={async () => {
              const result = await api.clearMediaCache(project.media!.id);
              useAppStore.getState().notify({
                kind: 'success',
                title: `Freed ${result.freedMb} MB`,
                message: 'Extracted audio and waveform data for this project. They rebuild when next needed.',
              });
              await useProjectStore.getState().loadWaveform();
            }}
          >
            Clear this project's cache
          </Button>
        ) : null}
      </section>

      {info ? (
        <p className="text-ink-500">
          SubtitleForge AI {info.version} · Electron {info.electron} · Chromium {info.chrome} · Python{' '}
          {capabilities?.platform.python ?? '?'} on {info.platform}/{info.arch}
        </p>
      ) : null}
    </div>
  );
}
