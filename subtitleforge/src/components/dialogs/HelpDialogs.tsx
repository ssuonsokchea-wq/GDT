import { Clapperboard } from 'lucide-react';
import { Button } from '@/components/common/Button';
import { Modal } from '@/components/common/Modal';
import { useAppStore } from '@/store/useAppStore';

const SHORTCUTS: Array<[string, Array<[string, string]>]> = [
  [
    'Playback',
    [
      ['Space', 'Play or pause'],
      ['J / L', 'Previous or next cue'],
      ['← / →', 'Nudge the playhead by 100 ms'],
      ['Shift + ← / →', 'Nudge by one second'],
    ],
  ],
  [
    'Editing',
    [
      ['Ctrl + Z', 'Undo'],
      ['Ctrl + Y', 'Redo'],
      ['N', 'Add a cue at the playhead'],
      ['Ctrl + Shift + S', 'Split the cue at the playhead'],
      ['Shift + Enter', 'Split a cue at the text cursor'],
      ['Ctrl + Shift + M', 'Merge the selected cues'],
      ['Delete', 'Delete the selected cues'],
      ['Ctrl + A', 'Select every cue'],
      ['↑ / ↓ in a timecode', 'Adjust by 100 ms, or 10 ms with Shift'],
    ],
  ],
  [
    'Project',
    [
      ['Ctrl + N', 'New project'],
      ['Ctrl + O', 'Open a project file'],
      ['Ctrl + S', 'Save a portable project file'],
      ['Ctrl + I', 'Import a video'],
      ['Ctrl + G', 'Generate subtitles'],
      ['Ctrl + E', 'Enhance the text'],
      ['Ctrl + Shift + E', 'Export video with burned subtitles'],
      ['Ctrl + B', 'Batch processing'],
    ],
  ],
];

export function ShortcutsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Modal open={open} onClose={onClose} title="Keyboard shortcuts" width="lg" footer={<Button onClick={onClose}>Close</Button>}>
      <div className="grid gap-5 sm:grid-cols-2">
        {SHORTCUTS.map(([group, rows]) => (
          <section key={group}>
            <h3 className="field-label mb-2">{group}</h3>
            <dl className="space-y-1">
              {rows.map(([keys, description]) => (
                <div key={keys} className="flex items-baseline justify-between gap-3">
                  <dt className="shrink-0 rounded border border-panel-700 bg-panel-850 px-1.5 py-0.5 font-mono text-2xs text-ink-300">
                    {keys}
                  </dt>
                  <dd className="min-w-0 flex-1 text-right text-2xs text-ink-400">{description}</dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </div>
    </Modal>
  );
}

export function AboutDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const info = useAppStore((state) => state.info);
  const capabilities = useAppStore((state) => state.capabilities);

  return (
    <Modal open={open} onClose={onClose} title="About SubtitleForge AI" width="sm" footer={<Button onClick={onClose}>Close</Button>}>
      <div className="space-y-4 text-center">
        <Clapperboard className="mx-auto h-10 w-10 text-accent" />
        <div>
          <h3 className="text-sm font-semibold text-ink-100">SubtitleForge AI</h3>
          <p className="text-2xs text-ink-500">Version {info?.version ?? '1.0.0'}</p>
        </div>
        <p className="text-2xs leading-relaxed text-ink-400">
          Subtitle generation, editing, styling and burn-in that runs entirely on your own computer. No account, no
          upload, no network.
        </p>
        <dl className="space-y-1 text-left text-2xs">
          <Row label="Speech recognition" value={`Faster-Whisper ${capabilities?.asr.version ?? ''}`} />
          <Row label="Video" value={capabilities?.tools.ffmpeg.version?.replace('ffmpeg version ', 'FFmpeg ') ?? 'FFmpeg'} />
          <Row label="Caption rendering" value="libass, through FFmpeg" />
          <Row label="Interface" value={`Electron ${info?.electron ?? ''} · React 18`} />
          <Row label="Engine" value={`Python ${capabilities?.platform.python ?? ''} · FastAPI · SQLite`} />
        </dl>
      </div>
    </Modal>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-panel-800 pb-1">
      <dt className="text-ink-500">{label}</dt>
      <dd className="truncate text-right font-mono text-ink-300" title={value}>
        {value}
      </dd>
    </div>
  );
}
