/**
 * The project panel.
 *
 * Top to bottom it follows the shape of the work: what file you are working
 * on, what you know about it, which subtitle tracks exist, who is speaking,
 * and what the engine is doing right now.
 */

import clsx from 'clsx';
import {
  AlertTriangle,
  AudioLines,
  FileVideo,
  FolderOpen,
  Link2,
  Plus,
  Trash2,
  Type,
  Users,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button, IconButton } from '@/components/common/Button';
import { Badge, EmptyState } from '@/components/common/Controls';
import { api } from '@/lib/api';
import { speakerColor } from '@/lib/subtitleText';
import { formatBytes, formatDuration, formatResolution } from '@/lib/time';
import { useAppStore } from '@/store/useAppStore';
import { useEditorStore } from '@/store/useEditorStore';
import { useProjectStore } from '@/store/useProjectStore';
import { JobQueue } from '@/components/batch/JobQueue';

export function ProjectPanel() {
  const project = useProjectStore((state) => state.project);
  const recents = useProjectStore((state) => state.recents);
  const openDialog = useAppStore((state) => state.openDialog);

  useEffect(() => {
    void useProjectStore.getState().loadRecents();
  }, []);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-9 shrink-0 items-center gap-1 border-b border-panel-750 px-2">
        <span className="field-label">Project</span>
        <div className="ml-auto flex items-center">
          <IconButton label="New project" onClick={() => void useProjectStore.getState().newProject()}>
            <Plus className="h-3.5 w-3.5" />
          </IconButton>
          <IconButton label="Open a project file" onClick={openProjectFile}>
            <FolderOpen className="h-3.5 w-3.5" />
          </IconButton>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {project ? (
          <>
            <MediaSection />
            <TrackSection />
            <SpeakerSection />
          </>
        ) : (
          <RecentProjects recents={recents} onPick={(id) => void useProjectStore.getState().openProject(id)} />
        )}
      </div>

      <div className="shrink-0 border-t border-panel-750">
        <JobQueue />
      </div>
      {project ? (
        <button
          type="button"
          onClick={() => openDialog('projects')}
          className="shrink-0 border-t border-panel-750 px-3 py-2 text-left text-2xs text-ink-500 hover:bg-panel-850 hover:text-ink-300"
        >
          All projects ({recents.length})
        </button>
      ) : null}
    </div>
  );
}

async function openProjectFile(): Promise<void> {
  const path = await window.sf.dialog.openProject();
  if (!path) return;
  try {
    const project = await api.importBundleFile(path);
    await useProjectStore.getState().openProject(project.id);
    await useProjectStore.getState().loadRecents();
    if (project.mediaMissing) {
      useAppStore.getState().notify({
        kind: 'warn',
        title: 'Project opened without its video',
        message: 'The subtitles are all here. Relink the video to preview or render.',
        sticky: true,
      });
    }
  } catch (error) {
    useAppStore.getState().reportError(error, 'Could not open that project file');
  }
}

function MediaSection() {
  const project = useProjectStore((state) => state.project)!;
  const media = project.media;

  return (
    <section className="border-b border-panel-800 p-3">
      <h3 className="field-label mb-2">Video</h3>
      {media ? (
        <div className="space-y-2">
          <div className="flex items-start gap-2">
            <FileVideo className="mt-0.5 h-4 w-4 shrink-0 text-ink-400" />
            <div className="min-w-0">
              <p className="selectable truncate text-xs text-ink-100" title={media.path}>
                {media.filename}
              </p>
              <p className="truncate text-2xs text-ink-500" title={media.path}>
                {media.path}
              </p>
            </div>
          </div>

          {media.exists === false ? (
            <div className="flex items-start gap-2 rounded border border-signal-warn/40 bg-signal-warn/10 p-2">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-signal-warn" />
              <div className="min-w-0 flex-1">
                <p className="text-2xs text-signal-warn">This file has moved or been renamed.</p>
                <Button
                  size="sm"
                  variant="ghost"
                  icon={<Link2 className="h-3 w-3" />}
                  className="mt-1"
                  onClick={async () => {
                    const paths = await window.sf.dialog.openVideos();
                    if (paths[0]) await useProjectStore.getState().relink(paths[0]);
                  }}
                >
                  Relink
                </Button>
              </div>
            </div>
          ) : null}

          <dl className="grid grid-cols-2 gap-x-2 gap-y-1 text-2xs">
            <Detail label="Duration" value={formatDuration(media.duration_ms)} />
            <Detail label="Resolution" value={formatResolution(media.width, media.height)} />
            <Detail label="Frame rate" value={media.fps ? `${media.fps.toFixed(3)} fps` : 'unknown'} />
            <Detail label="Size" value={formatBytes(media.size_bytes)} />
            <Detail label="Video" value={media.video_codec ?? 'unknown'} />
            <Detail
              label="Audio"
              value={
                media.audio_codec
                  ? `${media.audio_codec} · ${media.audio_channels ?? '?'}ch · ${
                      media.audio_sample_rate ? `${Math.round(media.audio_sample_rate / 1000)} kHz` : '?'
                    }`
                  : 'none'
              }
            />
          </dl>

          <div className="flex gap-1.5">
            <Button
              size="sm"
              variant="ghost"
              icon={<AudioLines className="h-3 w-3" />}
              onClick={() => void extractAudio(media.id)}
              title="Save the audio track as a separate file"
            >
              Extract audio
            </Button>
            <Button size="sm" variant="ghost" onClick={() => void window.sf.files.reveal(media.path)}>
              Show file
            </Button>
          </div>
        </div>
      ) : (
        <Button
          size="sm"
          full
          icon={<FileVideo className="h-3.5 w-3.5" />}
          onClick={async () => {
            const paths = await window.sf.dialog.openVideos();
            if (paths[0]) await useProjectStore.getState().importVideo(paths[0]);
          }}
        >
          Import a video
        </Button>
      )}
    </section>
  );
}

async function extractAudio(mediaId: string): Promise<void> {
  const target = await window.sf.dialog.saveAs({
    title: 'Extract audio',
    extensions: ['wav', 'mp3', 'aac', 'm4a', 'flac'],
    name: 'Audio',
  });
  if (!target) return;
  const extension = target.split('.').pop()?.toLowerCase() ?? 'wav';
  try {
    await api.extractAudio(mediaId, extension, target);
  } catch (error) {
    useAppStore.getState().reportError(error, 'Could not extract the audio');
  }
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="truncate text-ink-500">{label}</dt>
      <dd className="truncate font-mono text-ink-300" title={value}>
        {value}
      </dd>
    </div>
  );
}

function TrackSection() {
  const project = useProjectStore((state) => state.project)!;
  const [renaming, setRenaming] = useState<string | null>(null);
  const [draft, setDraft] = useState('');

  return (
    <section className="border-b border-panel-800 p-3">
      <h3 className="field-label mb-2">Subtitle tracks</h3>
      {project.tracks.length === 0 ? (
        <p className="text-2xs leading-relaxed text-ink-500">
          None yet. Generate subtitles from the audio, or import an SRT, VTT or ASS file.
        </p>
      ) : (
        <ul className="space-y-1">
          {project.tracks.map((track) => {
            const active = track.id === project.active_track_id;
            return (
              <li key={track.id}>
                <div
                  className={clsx(
                    'group flex items-center gap-2 rounded px-2 py-1.5 transition-colors duration-120',
                    active ? 'bg-accent-soft' : 'hover:bg-panel-850',
                  )}
                >
                  <button
                    type="button"
                    onClick={() => void useProjectStore.getState().selectTrack(track.id)}
                    onDoubleClick={() => {
                      setRenaming(track.id);
                      setDraft(track.name);
                    }}
                    className="min-w-0 flex-1 text-left"
                  >
                    {renaming === track.id ? (
                      <input
                        autoFocus
                        value={draft}
                        onChange={(event) => setDraft(event.target.value)}
                        onBlur={() => {
                          void useProjectStore.getState().renameTrack(track.id, draft || track.name);
                          setRenaming(null);
                        }}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter') event.currentTarget.blur();
                          if (event.key === 'Escape') setRenaming(null);
                        }}
                        className="selectable w-full rounded border border-accent bg-panel-850 px-1 text-xs text-ink-100 focus:outline-none"
                      />
                    ) : (
                      <span className={clsx('block truncate text-xs', active ? 'text-ink-100' : 'text-ink-300')}>
                        {track.name}
                      </span>
                    )}
                    <span className="flex items-center gap-1.5 text-2xs text-ink-500">
                      {track.cue_count} cues · {track.language}
                      {track.model ? ` · ${track.model}` : ''}
                    </span>
                  </button>
                  {track.enhanced ? <Badge tone="ok" title="Text has been enhanced">AI</Badge> : null}
                  <IconButton
                    label="Delete track"
                    className="opacity-0 group-hover:opacity-100 hover:text-signal-error"
                    onClick={() => void useProjectStore.getState().deleteTrack(track.id)}
                  >
                    <Trash2 className="h-3 w-3" />
                  </IconButton>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      <Button
        size="sm"
        variant="ghost"
        full
        className="mt-1.5"
        icon={<Type className="h-3 w-3" />}
        onClick={async () => {
          const path = await window.sf.dialog.openSubtitles();
          if (path) await useProjectStore.getState().importSubtitleFile(path);
        }}
      >
        Import subtitles
      </Button>
    </section>
  );
}

function SpeakerSection() {
  const project = useProjectStore((state) => state.project)!;
  const cues = useEditorStore((state) => state.cues);
  if (project.speakers.length === 0) return null;

  return (
    <section className="p-3">
      <h3 className="field-label mb-2 flex items-center gap-1.5">
        <Users className="h-3 w-3" />
        Speakers
      </h3>
      <p className="mb-2 text-2xs leading-relaxed text-ink-500">
        Estimated from the audio. Rename anyone you recognise; the names go into exports that support them.
      </p>
      <ul className="space-y-1">
        {project.speakers.map((speaker) => {
          const count = cues.filter((cue) => cue.speaker === speaker.label).length;
          return (
            <li key={speaker.id} className="flex items-center gap-2">
              <span
                className="h-2.5 w-2.5 shrink-0 rounded-full"
                style={{
                  backgroundColor: speakerColor(
                    speaker.label,
                    project.speakers.map((entry) => ({ label: entry.label, color: entry.color })),
                  ),
                }}
              />
              <input
                defaultValue={speaker.display_name ?? speaker.label}
                onBlur={async (event) => {
                  const value = event.target.value.trim();
                  if (value && value !== (speaker.display_name ?? speaker.label)) {
                    await api.patchSpeaker(speaker.id, { displayName: value });
                    await useProjectStore.getState().refresh();
                  }
                }}
                className="selectable min-w-0 flex-1 rounded border border-transparent bg-transparent px-1 py-0.5 text-xs text-ink-200 hover:border-panel-700 focus:border-accent focus:bg-panel-850 focus:outline-none"
              />
              <span className="shrink-0 font-mono text-2xs text-ink-500">{count}</span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function RecentProjects({
  recents,
  onPick,
}: {
  recents: Array<{ id: string; name: string; duration_ms?: number | null; media_filename?: string | null; mediaExists: boolean; archived: number }>;
  onPick: (id: string) => void;
}) {
  const active = recents.filter((project) => !project.archived);
  if (active.length === 0) {
    return (
      <EmptyState
        title="No projects yet"
        message="Import a video to start one. SubtitleForge keeps your projects on this machine only."
        action={
          <Button
            size="sm"
            variant="primary"
            onClick={async () => {
              const paths = await window.sf.dialog.openVideos();
              if (paths[0]) await useProjectStore.getState().newProject(paths[0]);
            }}
          >
            Import a video
          </Button>
        }
      />
    );
  }

  return (
    <div className="p-2">
      <h3 className="field-label mb-1.5 px-1">Recent</h3>
      <ul className="space-y-0.5">
        {active.slice(0, 12).map((project) => (
          <li key={project.id}>
            <button
              type="button"
              onClick={() => onPick(project.id)}
              className="w-full rounded px-2 py-1.5 text-left hover:bg-panel-850"
            >
              <span className="block truncate text-xs text-ink-200">{project.name}</span>
              <span className="block truncate text-2xs text-ink-500">
                {project.media_filename ?? 'no video'}
                {project.duration_ms ? ` · ${formatDuration(project.duration_ms)}` : ''}
                {project.mediaExists ? '' : ' · file missing'}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
