/**
 * All projects.
 *
 * A list rather than a gallery: the useful facts about a captioning project are
 * its name, its video, how long it is, and whether the file is still where it
 * was — none of which a thumbnail tells you.
 */

import clsx from 'clsx';
import { Archive, ArchiveRestore, Copy, FolderOpen, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button, IconButton } from '@/components/common/Button';
import { Badge, EmptyState } from '@/components/common/Controls';
import { Modal } from '@/components/common/Modal';
import { api } from '@/lib/api';
import { formatDuration, formatResolution } from '@/lib/time';
import { useProjectStore } from '@/store/useProjectStore';

export function ProjectsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const recents = useProjectStore((state) => state.recents);
  const current = useProjectStore((state) => state.project);
  const [showArchived, setShowArchived] = useState(false);

  useEffect(() => {
    if (open) void useProjectStore.getState().loadRecents();
  }, [open]);

  const visible = recents.filter((project) => (showArchived ? project.archived : !project.archived));

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Projects"
      description="Everything on this machine. Opening a project restores its cues, style and export settings."
      width="lg"
      footer={
        <>
          <Button variant="ghost" onClick={() => setShowArchived((value) => !value)}>
            {showArchived ? 'Show active' : 'Show archived'}
          </Button>
          <Button
            variant="secondary"
            icon={<FolderOpen className="h-3.5 w-3.5" />}
            onClick={async () => {
              const path = await window.sf.dialog.openProject();
              if (!path) return;
              const project = await api.importBundleFile(path);
              await useProjectStore.getState().openProject(project.id);
              onClose();
            }}
          >
            Open a project file
          </Button>
          <Button
            variant="primary"
            onClick={async () => {
              const paths = await window.sf.dialog.openVideos();
              if (paths[0]) {
                await useProjectStore.getState().newProject(paths[0]);
                onClose();
              }
            }}
          >
            New from video
          </Button>
        </>
      }
    >
      {visible.length === 0 ? (
        <EmptyState
          title={showArchived ? 'Nothing archived' : 'No projects yet'}
          message={showArchived ? undefined : 'Import a video to start one.'}
        />
      ) : (
        <ul className="divide-y divide-panel-800">
          {visible.map((project) => (
            <li
              key={project.id}
              className={clsx(
                'group flex items-center gap-3 px-2 py-2.5',
                project.id === current?.id && 'bg-accent-soft',
              )}
            >
              <button
                type="button"
                className="min-w-0 flex-1 text-left"
                onClick={async () => {
                  await useProjectStore.getState().openProject(project.id);
                  onClose();
                }}
              >
                <div className="flex items-center gap-2">
                  <span className="truncate text-xs text-ink-100">{project.name}</span>
                  {project.id === current?.id ? <Badge tone="accent">open</Badge> : null}
                  {project.mediaExists ? null : <Badge tone="warn">video missing</Badge>}
                </div>
                <p className="mt-0.5 truncate text-2xs text-ink-500">
                  {project.media_filename ?? 'no video'}
                  {project.duration_ms ? ` · ${formatDuration(project.duration_ms)}` : ''}
                  {project.width ? ` · ${formatResolution(project.width, project.height ?? null)}` : ''}
                  {project.last_opened_at ? ` · opened ${new Date(project.last_opened_at).toLocaleDateString()}` : ''}
                </p>
              </button>
              <div className="flex shrink-0 items-center opacity-0 transition-opacity duration-120 group-hover:opacity-100">
                <IconButton label="Duplicate" onClick={() => void useProjectStore.getState().duplicate(project.id)}>
                  <Copy className="h-3.5 w-3.5" />
                </IconButton>
                <IconButton
                  label={project.archived ? 'Restore' : 'Archive'}
                  onClick={() => void useProjectStore.getState().archive(project.id, !project.archived)}
                >
                  {project.archived ? <ArchiveRestore className="h-3.5 w-3.5" /> : <Archive className="h-3.5 w-3.5" />}
                </IconButton>
                <IconButton
                  label="Delete"
                  className="hover:text-signal-error"
                  onClick={() => void useProjectStore.getState().remove(project.id)}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </IconButton>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}
