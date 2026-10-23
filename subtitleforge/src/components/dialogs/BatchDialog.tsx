/**
 * Batch processing.
 *
 * A course author with forty lecture recordings has a different problem from
 * someone captioning one video: they do not want to watch. So the batch runs
 * one file at a time in the background, writes each output beside or into a
 * chosen folder, and keeps a row per file showing exactly what happened.
 */

import clsx from 'clsx';
import { CheckCircle2, FolderOpen, Layers, Play, Plus, X, XCircle } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button, IconButton, Spinner } from '@/components/common/Button';
import { Badge, Field, ProgressBar, Select, Toggle } from '@/components/common/Controls';
import { Modal } from '@/components/common/Modal';
import { api } from '@/lib/api';
import { useAppStore } from '@/store/useAppStore';
import { useJobStore } from '@/store/useJobStore';
import { useProjectStore } from '@/store/useProjectStore';
import type { Batch } from '@/types/api';

type Operation = Batch['operation'];

const OPERATIONS: Array<{ value: Operation; label: string; description: string }> = [
  {
    value: 'transcribe',
    label: 'Generate subtitles',
    description: 'One project per file, each with a generated and enhanced subtitle track.',
  },
  {
    value: 'transcribe_and_burn',
    label: 'Generate and burn in',
    description: 'Transcribe, then render a copy of each video with the captions burned into the picture.',
  },
  {
    value: 'burn',
    label: 'Burn existing subtitles',
    description: 'For videos that already have a matching subtitle file alongside them.',
  },
  {
    value: 'export',
    label: 'Export subtitle files',
    description: 'Transcribe and write an SRT beside each video, without re-encoding anything.',
  },
];

export function BatchDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const batches = useJobStore((state) => state.batches);
  const capabilities = useAppStore((state) => state.capabilities);
  const notify = useAppStore((state) => state.notify);
  const reportError = useAppStore((state) => state.reportError);

  const [paths, setPaths] = useState<string[]>([]);
  const [operation, setOperation] = useState<Operation>('transcribe');
  const [model, setModel] = useState('small');
  const [outputDir, setOutputDir] = useState<string | null>(null);
  const [enhance, setEnhance] = useState(true);
  const [presetName, setPresetName] = useState('Web 1080p');
  const [starting, setStarting] = useState(false);

  useEffect(() => {
    if (open) void useJobStore.getState().refreshBatches();
  }, [open]);

  const models = capabilities?.asr.models.filter((entry) => entry.installed) ?? [];

  const addFiles = async () => {
    const picked = await window.sf.dialog.openVideos();
    setPaths((current) => Array.from(new Set([...current, ...picked])));
  };

  const start = async () => {
    if (paths.length === 0) return;
    setStarting(true);
    try {
      const style = useProjectStore.getState().project?.settings.style;
      await api.createBatch({
        operation,
        paths,
        options: {
          transcription: { model },
          enhance,
          render: { presetName, outputDir },
          outputDir,
          style,
          format: 'srt',
        },
      });
      setPaths([]);
      await useJobStore.getState().refreshBatches();
      notify({
        kind: 'info',
        title: `Queued ${paths.length} file${paths.length === 1 ? '' : 's'}`,
        message: 'They run one at a time so the machine stays usable. You can close this window.',
      });
    } catch (error) {
      reportError(error, 'Could not start the batch');
    } finally {
      setStarting(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Batch processing"
      description="Queue many videos and leave them to run."
      width="xl"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Close
          </Button>
          <Button
            variant="primary"
            icon={<Play className="h-3.5 w-3.5" />}
            loading={starting}
            disabled={paths.length === 0}
            onClick={() => void start()}
          >
            Start {paths.length > 0 ? `(${paths.length})` : ''}
          </Button>
        </>
      }
    >
      <div className="grid gap-5 lg:grid-cols-[1fr_20rem]">
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <h3 className="field-label">Files</h3>
            <Badge tone="neutral">{paths.length}</Badge>
            <Button size="sm" variant="ghost" icon={<Plus className="h-3 w-3" />} className="ml-auto" onClick={() => void addFiles()}>
              Add videos
            </Button>
            {paths.length > 0 ? (
              <Button size="sm" variant="ghost" onClick={() => setPaths([])}>
                Clear
              </Button>
            ) : null}
          </div>

          {paths.length === 0 ? (
            <button
              type="button"
              onClick={() => void addFiles()}
              className="flex h-28 w-full flex-col items-center justify-center gap-2 rounded border border-dashed border-panel-700 text-ink-500 hover:border-accent hover:text-ink-300"
            >
              <Layers className="h-5 w-5" />
              <span className="text-xs">Add the videos you want processed</span>
            </button>
          ) : (
            <ul className="max-h-48 divide-y divide-panel-800 overflow-y-auto rounded border border-panel-750">
              {paths.map((path) => (
                <li key={path} className="flex items-center gap-2 px-2 py-1.5">
                  <span className="min-w-0 flex-1 truncate text-2xs text-ink-300" title={path}>
                    {path.split(/[\\/]/).pop()}
                  </span>
                  <IconButton
                    label="Remove from the batch"
                    className="h-5 w-5"
                    onClick={() => setPaths((current) => current.filter((entry) => entry !== path))}
                  >
                    <X className="h-3 w-3" />
                  </IconButton>
                </li>
              ))}
            </ul>
          )}

          <div>
            <h3 className="field-label mb-2">History</h3>
            {batches.length === 0 ? (
              <p className="text-2xs text-ink-500">No batches yet.</p>
            ) : (
              <ul className="space-y-2">
                {batches.slice(0, 6).map((batch) => (
                  <BatchRow key={batch.id} batch={batch} />
                ))}
              </ul>
            )}
          </div>
        </div>

        <div className="space-y-3">
          <div>
            <h3 className="field-label mb-2">Operation</h3>
            <div className="space-y-1.5">
              {OPERATIONS.map((entry) => (
                <button
                  key={entry.value}
                  type="button"
                  onClick={() => setOperation(entry.value)}
                  className={clsx(
                    'w-full rounded border px-2.5 py-2 text-left transition-colors duration-120',
                    operation === entry.value
                      ? 'border-accent bg-accent-soft'
                      : 'border-panel-700 bg-panel-850 hover:border-panel-600',
                  )}
                >
                  <span className="text-xs font-medium text-ink-100">{entry.label}</span>
                  <p className="mt-0.5 text-2xs leading-relaxed text-ink-500">{entry.description}</p>
                </button>
              ))}
            </div>
          </div>

          {operation !== 'burn' ? (
            <Field label="Model">
              <Select
                value={model}
                onChange={setModel}
                options={
                  models.length > 0
                    ? models.map((entry) => ({ value: entry.name, label: `${entry.name} · ${entry.accuracy}` }))
                    : [{ value: 'small', label: 'small (not installed)' }]
                }
              />
            </Field>
          ) : null}

          {operation === 'transcribe_and_burn' || operation === 'burn' ? (
            <Field label="Render preset">
              <Select
                value={presetName}
                onChange={setPresetName}
                options={[
                  { value: 'Draft', label: 'Draft' },
                  { value: 'Web 1080p', label: 'Web 1080p' },
                  { value: 'Social Vertical', label: 'Social Vertical' },
                  { value: 'Master 4K', label: 'Master 4K' },
                  { value: 'HEVC 4K', label: 'HEVC 4K' },
                ]}
              />
            </Field>
          ) : null}

          <Field label="Output folder" hint="Leave empty to write each output beside its source video.">
            <div className="flex gap-1.5">
              <button
                type="button"
                onClick={async () => setOutputDir(await window.sf.dialog.chooseFolder('Choose an output folder'))}
                className="flex h-8 min-w-0 flex-1 items-center gap-1.5 rounded border border-panel-700 bg-panel-850 px-2 text-left text-2xs text-ink-300 hover:border-panel-600"
              >
                <FolderOpen className="h-3 w-3 shrink-0" />
                <span className="truncate">{outputDir ?? 'Beside each source'}</span>
              </button>
              {outputDir ? (
                <IconButton label="Clear the output folder" onClick={() => setOutputDir(null)}>
                  <X className="h-3.5 w-3.5" />
                </IconButton>
              ) : null}
            </div>
          </Field>

          {operation !== 'burn' ? (
            <Toggle label="Enhance the text" checked={enhance} onChange={setEnhance} />
          ) : null}

          <p className="rounded border border-panel-750 bg-panel-850 p-2 text-2xs leading-relaxed text-ink-500">
            Each file becomes its own project, so you can open any of them afterwards and edit the result. Nothing is
            overwritten: an existing output gets a numbered name.
          </p>
        </div>
      </div>
    </Modal>
  );
}

function BatchRow({ batch }: { batch: Batch }) {
  const done = batch.items.filter((item) => item.status === 'succeeded').length;
  const failed = batch.items.filter((item) => item.status === 'failed').length;
  const running = batch.items.find((item) => item.status === 'running');

  return (
    <li className="rounded border border-panel-750 bg-panel-850 p-2">
      <div className="flex items-center gap-2">
        <span className="truncate text-2xs text-ink-200">{batch.name}</span>
        <Badge tone={failed > 0 ? 'warn' : batch.status === 'completed' ? 'ok' : 'neutral'}>{batch.status}</Badge>
        <span className="ml-auto shrink-0 font-mono text-2xs text-ink-500">
          {done}/{batch.items.length}
        </span>
        {batch.status === 'running' ? (
          <IconButton label="Cancel this batch" className="h-5 w-5" onClick={() => void useJobStore.getState().cancelBatch(batch.id)}>
            <X className="h-3 w-3" />
          </IconButton>
        ) : null}
      </div>
      <ProgressBar
        value={batch.progress}
        tone={failed > 0 ? 'warn' : 'accent'}
        className="mt-1.5"
      />
      {running ? (
        <p className="mt-1 flex items-center gap-1.5 truncate text-2xs text-ink-500">
          <Spinner className="h-2.5 w-2.5" />
          {running.media_path.split(/[\\/]/).pop()} · {Math.round((running.progress ?? 0) * 100)}%
        </p>
      ) : null}
      <ul className="mt-1 space-y-0.5">
        {batch.items.slice(0, 20).map((item) => (
          <li key={item.id} className="flex items-center gap-1.5 text-2xs">
            {item.status === 'succeeded' ? (
              <CheckCircle2 className="h-3 w-3 shrink-0 text-signal-ok" />
            ) : item.status === 'failed' ? (
              <XCircle className="h-3 w-3 shrink-0 text-signal-error" />
            ) : (
              <span className="h-3 w-3 shrink-0" />
            )}
            <span className="min-w-0 flex-1 truncate text-ink-400" title={item.media_path}>
              {item.media_path.split(/[\\/]/).pop()}
            </span>
            {item.output_path ? (
              <button
                type="button"
                onClick={() => void window.sf.files.reveal(item.output_path!)}
                className="shrink-0 text-accent-hover hover:underline"
              >
                show
              </button>
            ) : null}
            {item.error_json ? (
              <span className="shrink-0 text-signal-error" title={item.error_json.message}>
                {item.error_json.code}
              </span>
            ) : null}
          </li>
        ))}
      </ul>
    </li>
  );
}
