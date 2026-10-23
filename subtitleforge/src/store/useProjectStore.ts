/**
 * The open project: its media, tracks, speakers and settings.
 *
 * One project is open at a time, as in every editor this application sits
 * beside. Settings changes are written through to the backend immediately —
 * there is no separate save step for a style or a model choice, only for the
 * portable project file.
 */

import { create } from 'zustand';
import { api } from '@/lib/api';
import type {
  Project,
  ProjectSummary,
  SubtitleStyle,
  SubtitleTrack,
  Waveform,
} from '@/types/api';
import { useAppStore } from './useAppStore';
import { useEditorStore } from './useEditorStore';

interface ProjectState {
  project: Project | null;
  recents: ProjectSummary[];
  waveform: Waveform | null;
  loading: boolean;

  loadRecents: () => Promise<void>;
  newProject: (mediaPath?: string) => Promise<Project | null>;
  openProject: (id: string) => Promise<void>;
  closeProject: () => void;
  refresh: () => Promise<void>;
  rename: (name: string) => Promise<void>;
  archive: (id: string, archived: boolean) => Promise<void>;
  remove: (id: string) => Promise<void>;
  duplicate: (id: string) => Promise<void>;
  importVideo: (path: string) => Promise<void>;
  relink: (path: string) => Promise<void>;
  importSubtitleFile: (path: string) => Promise<void>;
  selectTrack: (trackId: string) => Promise<void>;
  deleteTrack: (trackId: string) => Promise<void>;
  renameTrack: (trackId: string, name: string) => Promise<void>;
  updateSettings: (patch: Record<string, unknown>) => Promise<void>;
  updateStyle: (patch: Partial<SubtitleStyle>) => Promise<void>;
  loadWaveform: () => Promise<void>;
  saveBundle: () => Promise<void>;
  activeTrack: () => SubtitleTrack | null;
}

export const useProjectStore = create<ProjectState>((set, get) => ({
  project: null,
  recents: [],
  waveform: null,
  loading: false,

  async loadRecents() {
    try {
      const { projects } = await api.listProjects(true);
      set({ recents: projects });
    } catch (error) {
      useAppStore.getState().reportError(error, 'Could not list projects');
    }
  },

  async newProject(mediaPath) {
    try {
      const project = await api.createProject(mediaPath ? { mediaPath } : {});
      await get().openProject(project.id);
      await get().loadRecents();
      return get().project;
    } catch (error) {
      useAppStore.getState().reportError(error, 'Could not create the project');
      return null;
    }
  },

  async openProject(id) {
    set({ loading: true, waveform: null });
    try {
      const project = await api.openProject(id);
      set({ project, loading: false });
      useEditorStore.getState().reset();
      if (project.active_track_id) {
        await useEditorStore.getState().loadTrack(project.active_track_id);
      }
      if (project.media) {
        void get().loadWaveform();
        if (project.media.exists === false) {
          useAppStore.getState().notify({
            kind: 'warn',
            title: 'The video is missing',
            message: project.media.path,
            hint: 'Use Relink in the project panel to point this project at the file’s new location.',
            sticky: true,
          });
        }
      }
    } catch (error) {
      set({ loading: false });
      useAppStore.getState().reportError(error, 'Could not open the project');
    }
  },

  closeProject() {
    set({ project: null, waveform: null });
    useEditorStore.getState().reset();
  },

  async refresh() {
    const current = get().project;
    if (!current) return;
    try {
      set({ project: await api.getProject(current.id) });
    } catch (error) {
      useAppStore.getState().reportError(error, 'Could not refresh the project');
    }
  },

  async rename(name) {
    const current = get().project;
    if (!current) return;
    set({ project: await api.patchProject(current.id, { name }) });
    await get().loadRecents();
  },

  async archive(id, archived) {
    await api.patchProject(id, { archived });
    await get().loadRecents();
  },

  async remove(id) {
    const confirmed = await window.sf.dialog.confirm({
      title: 'Delete project',
      message: 'Delete this project?',
      detail: 'The subtitles and edits in it are deleted. Your video file is not touched.',
      confirmLabel: 'Delete',
      danger: true,
    });
    if (!confirmed) return;
    await api.deleteProject(id);
    if (get().project?.id === id) get().closeProject();
    await get().loadRecents();
  },

  async duplicate(id) {
    const copy = await api.duplicateProject(id);
    await get().loadRecents();
    await get().openProject(copy.id);
  },

  async importVideo(path) {
    let current = get().project;
    try {
      if (!current) {
        await get().newProject(path);
        return;
      }
      await api.importMedia(path, current.id);
      await get().refresh();
      current = get().project;
      if (current?.media) void get().loadWaveform();
      useAppStore.getState().notify({ kind: 'success', title: 'Video imported' });
    } catch (error) {
      useAppStore.getState().reportError(error, 'Could not import that video');
    }
  },

  async relink(path) {
    const current = get().project;
    if (!current) return;
    try {
      const project = await api.relinkProject(current.id, path);
      set({ project, waveform: null });
      void get().loadWaveform();
      useAppStore.getState().notify({ kind: 'success', title: 'Project relinked' });
    } catch (error) {
      useAppStore.getState().reportError(error, 'Could not relink the project');
    }
  },

  async importSubtitleFile(path) {
    const current = get().project;
    if (!current) return;
    try {
      const { track, cueCount } = await api.importSubtitles({ projectId: current.id, path });
      await get().refresh();
      await get().selectTrack(track.id);
      useAppStore.getState().notify({
        kind: 'success',
        title: 'Subtitles imported',
        message: `${cueCount} cues from ${path.split(/[\\/]/).pop()}`,
      });
    } catch (error) {
      useAppStore.getState().reportError(error, 'Could not import those subtitles');
    }
  },

  async selectTrack(trackId) {
    const current = get().project;
    if (!current) return;
    set({ project: await api.patchProject(current.id, { activeTrackId: trackId }) });
    await useEditorStore.getState().loadTrack(trackId);
  },

  async deleteTrack(trackId) {
    const confirmed = await window.sf.dialog.confirm({
      title: 'Delete subtitle track',
      message: 'Delete this subtitle track?',
      detail: 'Every cue in it is removed. Other tracks in the project are unaffected.',
      confirmLabel: 'Delete',
      danger: true,
    });
    if (!confirmed) return;
    await api.deleteTrack(trackId);
    await get().refresh();
    const next = get().project?.active_track_id;
    if (next) await useEditorStore.getState().loadTrack(next);
    else useEditorStore.getState().reset();
  },

  async renameTrack(trackId, name) {
    await api.patchTrack(trackId, { name });
    await get().refresh();
  },

  async updateSettings(patch) {
    const current = get().project;
    if (!current) return;
    // Optimistic: the style panel's sliders must not wait for a round trip.
    set({ project: { ...current, settings: { ...current.settings, ...patch } as Project['settings'] } });
    try {
      set({ project: await api.patchProject(current.id, { settings: patch }) });
    } catch (error) {
      useAppStore.getState().reportError(error, 'Could not save that setting');
      await get().refresh();
    }
  },

  async updateStyle(patch) {
    const current = get().project;
    if (!current) return;
    await get().updateSettings({ style: { ...current.settings.style, ...patch } });
  },

  async loadWaveform() {
    const media = get().project?.media;
    if (!media) return;
    try {
      set({ waveform: await api.waveform(media.id) });
    } catch {
      // Not built yet: queue it. The job's completion event triggers a reload.
      try {
        await api.buildWaveform(media.id);
      } catch (error) {
        useAppStore.getState().reportError(error, 'Could not analyse the audio');
      }
    }
  },

  async saveBundle() {
    const current = get().project;
    if (!current) return;
    const target = await window.sf.dialog.saveAs({
      title: 'Save project',
      defaultPath: `${current.name}.sfproj`,
      extensions: ['sfproj'],
      name: 'SubtitleForge project',
    });
    if (!target) return;
    try {
      await api.saveBundle(current.id, target);
      useAppStore.getState().notify({
        kind: 'success',
        title: 'Project saved',
        message: target,
        action: { label: 'Show file', run: () => void window.sf.files.reveal(target) },
      });
    } catch (error) {
      useAppStore.getState().reportError(error, 'Could not save the project file');
    }
  },

  activeTrack() {
    const project = get().project;
    if (!project?.active_track_id) return null;
    return project.tracks.find((track) => track.id === project.active_track_id) ?? null;
  },
}));
