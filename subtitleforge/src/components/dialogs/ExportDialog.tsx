/**
 * Export.
 *
 * Two kinds of output with one thing in common: the user should see what they
 * are about to get before they commit. Subtitle files get a text preview;
 * burned video gets the render plan — encoder, resolution, estimated time —
 * because a two-hour 4K render is not something to discover was wrong
 * afterwards.
 */

import clsx from 'clsx';
import { Film, FileText, Flame, Monitor, Zap } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button } from '@/components/common/Button';
import { Badge, Field, SegmentedControl, Select, Slider, Toggle } from '@/components/common/Controls';
import { Modal } from '@/components/common/Modal';
import { api } from '@/lib/api';
import { formatBytes, formatEstimate } from '@/lib/time';
import { useAppStore } from '@/store/useAppStore';
import { useEditorStore } from '@/store/useEditorStore';
import { useProjectStore } from '@/store/useProjectStore';
import type { BurnPlan, RenderPreset } from '@/types/api';
import { Notice } from './TranscribeDialog';

type Mode = 'file' | 'video';
type Format = 'srt' | 'vtt' | 'ass';

const FORMAT_NOTES: Record<Format, string> = {
  srt: 'The universal format. Every player and platform reads it; it carries no styling.',
  vtt: 'The web format, required by HTML video and supported by YouTube. Carries speaker voices and basic cues.',
  ass: 'Advanced Substation Alpha. Carries your full style — font, colour, outline, position — and is what the burn-in uses.',
};

export function ExportDialog({ open, onClose, initialMode = 'file' }: { open: boolean; onClose: () => void; initialMode?: Mode }) {
  const project = useProjectStore((state) => state.project);
  const trackId = useEditorStore((state) => state.trackId);
  const cues = useEditorStore((state) => state.cues);
  const quality = useEditorStore((state) => state.quality);
  const notify = useAppStore((state) => state.notify);
  const reportError = useAppStore((state) => state.reportError);

  const [mode, setMode] = useState<Mode>(initialMode);
  const [format, setFormat] = useState<Format>('srt');
  const [includeSpeakers, setIncludeSpeakers] = useState(false);
  const [preview, setPreview] = useState<string>('');
  const [presets, setPresets] = useState<RenderPreset[]>([]);
  const [presetName, setPresetName] = useState('Web 1080p');
  const [allowHardware, setAllowHardware] = useState(true);
  const [crf, setCrf] = useState(21);
  const [audio, setAudio] = useState<'copy' | 'aac' | 'none'>('copy');
  const [plan, setPlan] = useState<BurnPlan | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setMode(initialMode);
  }, [initialMode, open]);

  useEffect(() => {
    if (!open || !trackId || mode !== 'file') return;
    void api
      .previewTrack(trackId, format)
      .then((response) => setPreview(response.text.slice(0, 4000)))
      .catch(() => setPreview(''));
  }, [open, trackId, format, mode]);

  useEffect(() => {
    if (!open) return;
    void api
      .renderPresets()
      .then((response) => {
        setPresets(response.presets);
        const chosen = response.presets.find((preset) => preset.name === presetName);
        if (chosen) setCrf(chosen.crf);
      })
      .catch(() => setPresets([]));
  }, [open]);

  // Recompute the plan whenever a setting that changes the output changes.
  useEffect(() => {
    if (!open || !trackId || mode !== 'video') return;
    let cancelled = false;
    void api
      .renderPlan({ trackId, render: { presetName, allowHardware, crf, audio } })
      .then((next) => {
        if (!cancelled) setPlan(next);
      })
      .catch(() => {
        if (!cancelled) setPlan(null);
      });
    return () => {
      cancelled = true;
    };
  }, [open, trackId, mode, presetName, allowHardware, crf, audio]);

  const exportFile = async () => {
    if (!trackId || !project) return;
    const base = project.media?.filename.replace(/\.[^.]+$/, '') ?? project.name;
    const target = await window.sf.dialog.saveAs({
      title: `Export ${format.toUpperCase()}`,
      defaultPath: `${base}.${format}`,
      extensions: [format],
      name: format.toUpperCase(),
    });
    if (!target) return;
    setBusy(true);
    try {
      await useEditorStore.getState().flush();
      await api.exportSubtitles({ trackId, format, outputPath: target, includeSpeakers });
      onClose();
    } catch (error) {
      reportError(error, 'Export failed');
    } finally {
      setBusy(false);
    }
  };

  const renderVideo = async () => {
    if (!trackId || !project?.media) return;
    const base = project.media.filename.replace(/\.[^.]+$/, '');
    const target = await window.sf.dialog.saveAs({
      title: 'Render video with burned subtitles',
      defaultPath: `${base}_subtitled.mp4`,
      extensions: ['mp4'],
      name: 'MP4 video',
    });
    if (!target) return;
    setBusy(true);
    try {
      await useEditorStore.getState().flush();
      await api.render({ trackId, outputPath: target, render: { presetName, allowHardware, crf, audio } });
      notify({
        kind: 'info',
        title: 'Rendering',
        message: `${plan?.outputWidth ?? ''}x${plan?.outputHeight ?? ''} with ${plan?.encoder ?? 'FFmpeg'}. You can keep editing; progress is in the status bar.`,
      });
      onClose();
    } catch (error) {
      reportError(error, 'Could not start the render');
    } finally {
      setBusy(false);
    }
  };

  const estimatedSize = plan && project?.media?.duration_ms
    ? ((project.media.duration_ms / 1000) * plan.bitrateKbps * 1000) / 8
    : null;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Export"
      description={`${cues.length} cues from "${useProjectStore.getState().activeTrack()?.name ?? 'the current track'}".`}
      width="lg"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          {mode === 'file' ? (
            <Button variant="primary" icon={<FileText className="h-3.5 w-3.5" />} loading={busy} onClick={() => void exportFile()}>
              Export {format.toUpperCase()}
            </Button>
          ) : (
            <Button
              variant="primary"
              icon={<Flame className="h-3.5 w-3.5" />}
              loading={busy}
              disabled={!project?.media}
              onClick={() => void renderVideo()}
            >
              Render video
            </Button>
          )}
        </>
      }
    >
      <SegmentedControl
        value={mode}
        onChange={setMode}
        className="mb-4 w-full"
        options={[
          { value: 'file', label: 'Subtitle file' },
          { value: 'video', label: 'Video with burned subtitles' },
        ]}
      />

      {quality && quality.counts.error > 0 ? (
        <Notice
          tone="warn"
          title={`${quality.counts.error} cue${quality.counts.error === 1 ? '' : 's'} still fail a check`}
          message="Overlaps and unreadable reading speeds travel into the export. The Quality tab lists them."
        />
      ) : null}

      {mode === 'file' ? (
        <div className="space-y-4">
          <Field label="Format">
            <SegmentedControl
              value={format}
              onChange={setFormat}
              className="w-full"
              options={[
                { value: 'srt', label: 'SRT' },
                { value: 'vtt', label: 'WebVTT' },
                { value: 'ass', label: 'ASS' },
              ]}
            />
          </Field>
          <p className="text-2xs leading-relaxed text-ink-400">{FORMAT_NOTES[format]}</p>
          {format !== 'ass' ? (
            <Toggle
              label="Write speaker names into the text"
              checked={includeSpeakers}
              onChange={setIncludeSpeakers}
              hint={
                format === 'vtt'
                  ? 'As WebVTT voice spans, which players can style separately.'
                  : 'As a "Name:" prefix, since SRT has no speaker field.'
              }
            />
          ) : (
            <p className="text-2xs text-ink-500">
              ASS carries your style, so the exported file looks the same in any player that supports it — VLC, MPV,
              Plex.
            </p>
          )}
          <div>
            <span className="field-label">Preview</span>
            <pre className="selectable mt-1 max-h-56 overflow-auto rounded border border-panel-750 bg-panel-950 p-3 font-mono text-2xs leading-relaxed text-ink-300">
              {preview || 'Nothing to preview.'}
            </pre>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <div>
            <h3 className="field-label mb-2">Quality preset</h3>
            <div className="space-y-1.5">
              {presets.map((preset) => (
                <button
                  key={preset.name}
                  type="button"
                  onClick={() => {
                    setPresetName(preset.name);
                    setCrf(preset.crf);
                    setAudio(preset.audio as 'copy' | 'aac' | 'none');
                  }}
                  className={clsx(
                    'flex w-full items-start gap-3 rounded border px-3 py-2 text-left transition-colors duration-120',
                    presetName === preset.name
                      ? 'border-accent bg-accent-soft'
                      : 'border-panel-700 bg-panel-850 hover:border-panel-600',
                  )}
                >
                  <Monitor className="mt-0.5 h-3.5 w-3.5 shrink-0 text-ink-400" />
                  <div className="min-w-0 flex-1">
                    <span className="text-xs font-medium text-ink-100">{preset.name}</span>
                    <p className="mt-0.5 text-2xs leading-relaxed text-ink-500">{preset.description}</p>
                  </div>
                  <Badge tone="neutral">{preset.codec.toUpperCase()}</Badge>
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Audio" hint="Copying is instant and lossless; re-encoding to AAC fixes a track a player rejects.">
              <Select
                value={audio}
                onChange={setAudio}
                options={[
                  { value: 'copy', label: 'Copy unchanged' },
                  { value: 'aac', label: 'Re-encode to AAC 192k' },
                  { value: 'none', label: 'No audio' },
                ]}
              />
            </Field>
            <div className="space-y-2">
              <Slider label="Quality (lower is better)" value={crf} min={14} max={34} onChange={setCrf} />
              <Toggle
                label="Use the GPU when available"
                checked={allowHardware}
                onChange={setAllowHardware}
                hint="Several times faster. If the driver refuses, the render falls back to software and says so."
              />
            </div>
          </div>

          {plan ? (
            <div className="rounded border border-panel-750 bg-panel-850 p-3">
              <h4 className="field-label mb-2">What will happen</h4>
              <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-2xs">
                <PlanRow label="Encoder" value={plan.encoder} icon={plan.hardware ? <Zap className="h-3 w-3 text-signal-ok" /> : undefined} />
                <PlanRow label="Output size" value={`${plan.outputWidth}x${plan.outputHeight}`} />
                <PlanRow label="Estimated time" value={formatEstimate(plan.estimatedSeconds)} />
                <PlanRow label="Estimated file" value={estimatedSize ? formatBytes(estimatedSize) : 'unknown'} />
              </dl>
              <p className="mt-2 truncate text-2xs text-ink-500" title={plan.outputPath}>
                {plan.outputPath}
              </p>
              {!plan.hardware && allowHardware ? (
                <p className="mt-1.5 text-2xs leading-relaxed text-signal-warn">
                  No usable hardware encoder was found, so this will be encoded by the CPU. It will work; it will take
                  longer.
                </p>
              ) : null}
            </div>
          ) : (
            <p className="text-2xs text-ink-500">Working out the render plan…</p>
          )}

          <p className="flex items-start gap-2 text-2xs leading-relaxed text-ink-500">
            <Film className="mt-0.5 h-3 w-3 shrink-0" />
            Burned captions become part of the picture: they cannot be switched off, and they are what every platform
            shows. Keep the SRT as well if you may need an editable version.
          </p>
        </div>
      )}
    </Modal>
  );
}

function PlanRow({ label, value, icon }: { label: string; value: string; icon?: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-ink-500">{label}</dt>
      <dd className="flex items-center gap-1 truncate font-mono text-ink-200">
        {icon}
        {value}
      </dd>
    </div>
  );
}
