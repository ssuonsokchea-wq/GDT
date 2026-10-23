/**
 * The title bar: project identity on the left, the actions that define the
 * workflow in the middle, status on the right.
 *
 * The middle group is the whole application in four buttons — import, generate,
 * enhance, export — in the order a user performs them.
 */

import clsx from 'clsx';
import {
  Clapperboard,
  Download,
  FolderOpen,
  Layers,
  Save,
  Sparkles,
  Wand2,
} from 'lucide-react';
import { Button } from '@/components/common/Button';
import { api } from '@/lib/api';
import { Badge } from '@/components/common/Controls';
import { useAppStore } from '@/store/useAppStore';
import { useEditorStore } from '@/store/useEditorStore';
import { useJobStore } from '@/store/useJobStore';
import { useProjectStore } from '@/store/useProjectStore';

export function TitleBar() {
  const project = useProjectStore((state) => state.project);
  const openDialog = useAppStore((state) => state.openDialog);
  const backend = useAppStore((state) => state.backend);
  const saving = useEditorStore((state) => state.saving);
  const dirty = useEditorStore((state) => state.dirty);
  const trackId = useEditorStore((state) => state.trackId);
  const cueCount = useEditorStore((state) => state.cues.length);
  const transcribing = useJobStore((state) => state.jobOfType('transcribe'));
  const enhancing = useJobStore((state) => state.jobOfType('enhance'));
  const rendering = useJobStore((state) => state.jobOfType('render'));

  const ready = backend.state === 'ready';

  async function runEnhancement(): Promise<void> {
    const editor = useEditorStore.getState();
    if (!editor.trackId) return;
    try {
      await editor.flush();
      await api.enhance({ trackId: editor.trackId });
    } catch (error) {
      useAppStore.getState().reportError(error, 'Could not enhance the text');
    }
  }

  const hasMedia = Boolean(project?.media);

  return (
    <header className="flex h-12 shrink-0 items-center gap-3 border-b border-panel-750 bg-panel-900 px-3">
      <div className="flex items-center gap-2 pr-1">
        <Clapperboard className="h-4 w-4 text-accent" />
        <span className="text-xs font-semibold tracking-tight text-ink-200">SubtitleForge</span>
      </div>

      <div className="h-5 w-px bg-panel-750" />

      <div className="flex min-w-0 items-center gap-2">
        <button
          type="button"
          onClick={() => openDialog('projects')}
          className="max-w-[22rem] truncate rounded px-2 py-1 text-xs text-ink-200 hover:bg-panel-800"
          title={project ? `${project.name} — click to switch project` : 'Open a project'}
        >
          {project ? project.name : 'No project open'}
        </button>
        {trackId ? <Badge tone="neutral">{cueCount} cues</Badge> : null}
        {saving ? (
          <span className="text-2xs text-ink-500">Saving…</span>
        ) : dirty ? (
          <span className="text-2xs text-signal-warn">Unsaved edit</span>
        ) : null}
      </div>

      <div className="mx-auto flex items-center gap-1.5">
        <Button
          size="sm"
          icon={<FolderOpen className="h-3.5 w-3.5" />}
          disabled={!ready}
          onClick={async () => {
            const paths = await window.sf.dialog.openVideos();
            if (paths.length === 1) await useProjectStore.getState().importVideo(paths[0]!);
            else if (paths.length > 1) openDialog('batch');
          }}
        >
          Import video
        </Button>
        <Button
          size="sm"
          variant="primary"
          icon={<Sparkles className="h-3.5 w-3.5" />}
          disabled={!ready || !hasMedia || Boolean(transcribing)}
          loading={Boolean(transcribing)}
          onClick={() => openDialog('transcribe')}
        >
          {transcribing ? 'Generating…' : 'Generate subtitles'}
        </Button>
        <Button
          size="sm"
          icon={<Wand2 className="h-3.5 w-3.5" />}
          disabled={!trackId || cueCount === 0 || Boolean(enhancing)}
          loading={Boolean(enhancing)}
          onClick={() => void runEnhancement()}
          onContextMenu={(event) => {
            // Right-click opens the options rather than running them blind.
            event.preventDefault();
            openDialog('settings');
          }}
          title="Restore punctuation, fix capitalisation, remove fillers. Right-click for options."
        >
          Enhance
        </Button>
        <Button
          size="sm"
          icon={<Download className="h-3.5 w-3.5" />}
          disabled={!trackId || cueCount === 0 || Boolean(rendering)}
          onClick={() => openDialog('export')}
        >
          Export
        </Button>
      </div>

      <div className="flex items-center gap-1.5">
        <Button
          size="sm"
          variant="ghost"
          icon={<Layers className="h-3.5 w-3.5" />}
          onClick={() => openDialog('batch')}
          title="Batch processing (Ctrl+B)"
        >
          Batch
        </Button>
        <Button
          size="sm"
          variant="ghost"
          icon={<Save className="h-3.5 w-3.5" />}
          disabled={!project}
          onClick={() => void useProjectStore.getState().saveBundle()}
          title="Save a portable project file (Ctrl+S)"
        >
          Save
        </Button>
        <div
          className={clsx(
            'ml-1 h-2 w-2 rounded-full',
            ready ? 'bg-signal-ok' : backend.state === 'failed' ? 'bg-signal-error' : 'bg-signal-warn animate-pulse',
          )}
          title={
            ready
              ? 'Subtitle engine running'
              : backend.state === 'failed'
                ? backend.reason
                : 'Subtitle engine starting'
          }
        />
      </div>
    </header>
  );
}
