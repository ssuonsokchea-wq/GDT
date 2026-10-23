/**
 * The subtitle editor: cues, selection, playhead and undo history.
 *
 * Two decisions shape this store.
 *
 * **Edits are local first.** Typing in a cue updates state immediately and
 * schedules a save; waiting for a round trip per keystroke would make the
 * editor feel like a web form. The backend remains the authority — it
 * renumbers, resolves overlaps and journals each commit — and its reply
 * replaces local state.
 *
 * **Undo is a stack of whole cue lists.** A thousand cues is a few hundred
 * kilobytes, so a 100-step history costs less than the complexity of inverse
 * operations, and it cannot drift out of step with the document the way
 * patch-based undo does once split and merge are involved.
 */

import { create } from 'zustand';
import { api } from '@/lib/api';
import { comfortableDurationMs } from '@/lib/subtitleText';
import type { Cue, QualityReport } from '@/types/api';
import { useAppStore } from './useAppStore';

const HISTORY_LIMIT = 100;
const SAVE_DEBOUNCE_MS = 600;

function clone(cues: Cue[]): Cue[] {
  return cues.map((cue) => ({ ...cue, words: cue.words }));
}

function reindex(cues: Cue[]): Cue[] {
  return [...cues]
    .sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs)
    .map((cue, index) => ({ ...cue, idx: index + 1 }));
}

interface EditorState {
  trackId: string | null;
  cues: Cue[];
  selection: string[];
  playheadMs: number;
  playing: boolean;
  zoom: number;            // pixels per second in the timeline
  quality: QualityReport | null;
  past: Cue[][];
  future: Cue[][];
  dirty: boolean;
  saving: boolean;
  focusCueId: string | null;

  loadTrack: (trackId: string) => Promise<void>;
  reset: () => void;
  select: (cueId: string | null, mode?: 'replace' | 'toggle' | 'range') => void;
  selectAll: () => void;
  setPlayhead: (ms: number) => void;
  setPlaying: (playing: boolean) => void;
  setZoom: (pixelsPerSecond: number) => void;
  focusCue: (cueId: string | null) => void;

  editText: (cueId: string, text: string) => void;
  editTiming: (cueId: string, startMs: number, endMs: number) => void;
  nudge: (cueId: string, deltaMs: number) => void;
  setSpeaker: (cueId: string, speaker: string | null) => void;
  toggleLock: (cueId: string) => void;
  fitDuration: (cueId: string) => void;
  addCueAtPlayhead: () => void;
  deleteSelected: () => Promise<void>;
  splitAtPlayhead: () => Promise<void>;
  splitAtCaret: (cueId: string, caret: number) => Promise<void>;
  mergeSelected: () => Promise<void>;
  shiftAll: (deltaMs: number) => Promise<void>;
  resegment: (maxChars: number, maxLines: number) => Promise<void>;
  undo: () => void;
  redo: () => void;
  flush: () => Promise<void>;
  refreshQuality: () => Promise<void>;
}

let saveTimer: number | undefined;

export const useEditorStore = create<EditorState>((set, get) => {
  /** Push the current cues onto the undo stack before a change. */
  function commit(next: Cue[], options: { immediate?: boolean; label?: string } = {}): void {
    const { cues, past } = get();
    set({
      past: [...past, clone(cues)].slice(-HISTORY_LIMIT),
      future: [],
      cues: reindex(next),
      dirty: true,
    });
    scheduleSave(options.immediate ? 0 : SAVE_DEBOUNCE_MS, options.label);
  }

  function scheduleSave(delay: number, label?: string): void {
    window.clearTimeout(saveTimer);
    saveTimer = window.setTimeout(() => void save(label), delay);
  }

  async function save(label?: string): Promise<void> {
    const { trackId, cues, dirty } = get();
    if (!trackId || !dirty) return;
    set({ saving: true });
    try {
      const response = await api.replaceCues(trackId, cues, label ?? 'edit');
      set({ cues: response.cues, dirty: false, saving: false });
      void get().refreshQuality();
    } catch (error) {
      set({ saving: false });
      useAppStore.getState().reportError(error, 'Could not save your edit');
    }
  }

  return {
    trackId: null,
    cues: [],
    selection: [],
    playheadMs: 0,
    playing: false,
    zoom: 60,
    quality: null,
    past: [],
    future: [],
    dirty: false,
    saving: false,
    focusCueId: null,

    async loadTrack(trackId) {
      window.clearTimeout(saveTimer);
      try {
        const { cues } = await api.listCues(trackId, true);
        set({ trackId, cues, selection: [], past: [], future: [], dirty: false, focusCueId: null });
        void get().refreshQuality();
      } catch (error) {
        useAppStore.getState().reportError(error, 'Could not load that subtitle track');
      }
    },

    reset() {
      window.clearTimeout(saveTimer);
      set({
        trackId: null,
        cues: [],
        selection: [],
        past: [],
        future: [],
        dirty: false,
        quality: null,
        playheadMs: 0,
        playing: false,
        focusCueId: null,
      });
    },

    select(cueId, mode = 'replace') {
      if (!cueId) {
        set({ selection: [] });
        return;
      }
      const { selection, cues } = get();
      if (mode === 'toggle') {
        set({
          selection: selection.includes(cueId)
            ? selection.filter((id) => id !== cueId)
            : [...selection, cueId],
        });
        return;
      }
      if (mode === 'range' && selection.length > 0) {
        const ids = cues.map((cue) => cue.id!);
        const anchor = ids.indexOf(selection[selection.length - 1]!);
        const target = ids.indexOf(cueId);
        if (anchor >= 0 && target >= 0) {
          const [from, to] = anchor < target ? [anchor, target] : [target, anchor];
          set({ selection: ids.slice(from, to + 1) });
          return;
        }
      }
      set({ selection: [cueId] });
    },

    selectAll() {
      set({ selection: get().cues.map((cue) => cue.id!).filter(Boolean) });
    },

    setPlayhead(ms) {
      set({ playheadMs: Math.max(0, Math.round(ms)) });
    },

    setPlaying(playing) {
      set({ playing });
    },

    setZoom(pixelsPerSecond) {
      set({ zoom: Math.max(6, Math.min(600, pixelsPerSecond)) });
    },

    focusCue(cueId) {
      set({ focusCueId: cueId });
    },

    editText(cueId, text) {
      commit(get().cues.map((cue) => (cue.id === cueId ? { ...cue, text } : cue)));
    },

    editTiming(cueId, startMs, endMs) {
      const next = get().cues.map((cue) =>
        cue.id === cueId
          ? { ...cue, startMs: Math.max(0, Math.round(startMs)), endMs: Math.max(Math.round(startMs) + 40, Math.round(endMs)) }
          : cue,
      );
      commit(next, { label: 'retime cue' });
    },

    nudge(cueId, deltaMs) {
      const cue = get().cues.find((candidate) => candidate.id === cueId);
      if (!cue) return;
      get().editTiming(cueId, cue.startMs + deltaMs, cue.endMs + deltaMs);
    },

    setSpeaker(cueId, speaker) {
      commit(
        get().cues.map((cue) => (cue.id === cueId ? { ...cue, speaker } : cue)),
        { immediate: true, label: 'assign speaker' },
      );
    },

    toggleLock(cueId) {
      commit(
        get().cues.map((cue) => (cue.id === cueId ? { ...cue, locked: !cue.locked } : cue)),
        { immediate: true, label: 'lock cue' },
      );
    },

    /** Give a cue the time its text needs, within the gap that follows it. */
    fitDuration(cueId) {
      const { cues } = get();
      const index = cues.findIndex((cue) => cue.id === cueId);
      const cue = cues[index];
      if (!cue) return;
      const ceiling = cues[index + 1] ? cues[index + 1]!.startMs - 80 : cue.endMs + 4000;
      const wanted = cue.startMs + comfortableDurationMs(cue.text);
      get().editTiming(cueId, cue.startMs, Math.min(wanted, Math.max(ceiling, cue.startMs + 700)));
    },

    addCueAtPlayhead() {
      const { cues, playheadMs } = get();
      const next = cues.find((cue) => cue.startMs > playheadMs);
      const end = Math.min(playheadMs + 2000, next ? next.startMs - 80 : playheadMs + 2000);
      const fresh: Cue = {
        id: `new_${Date.now()}`,
        idx: 0,
        startMs: playheadMs,
        endMs: Math.max(playheadMs + 700, end),
        text: '',
        rawText: null,
        speaker: null,
        confidence: null,
        styleOverride: null,
        locked: false,
        cps: 0,
        words: [],
      };
      commit([...cues, fresh], { immediate: true, label: 'add cue' });
      set({ selection: [fresh.id!], focusCueId: fresh.id });
    },

    async deleteSelected() {
      const { selection, cues } = get();
      if (selection.length === 0) return;
      commit(
        cues.filter((cue) => !selection.includes(cue.id!)),
        { immediate: true, label: 'delete cues' },
      );
      set({ selection: [] });
    },

    async splitAtPlayhead() {
      const { cues, playheadMs, trackId } = get();
      if (!trackId) return;
      const target = cues.find((cue) => playheadMs > cue.startMs && playheadMs < cue.endMs);
      if (!target?.id) {
        useAppStore.getState().notify({
          kind: 'info',
          title: 'Nothing to split',
          message: 'Place the playhead inside a cue first.',
        });
        return;
      }
      await get().flush();
      try {
        // Splitting uses word timings, which only the backend holds.
        const { cues: updated } = await api.splitCue(trackId, target.id, { atMs: playheadMs });
        set((state) => ({ past: [...state.past, clone(state.cues)].slice(-HISTORY_LIMIT), future: [], cues: updated }));
      } catch (error) {
        useAppStore.getState().reportError(error, 'Could not split that cue');
      }
    },

    async splitAtCaret(cueId, caret) {
      const { trackId } = get();
      if (!trackId) return;
      await get().flush();
      try {
        const { cues: updated } = await api.splitCue(trackId, cueId, { atChar: caret });
        set((state) => ({ past: [...state.past, clone(state.cues)].slice(-HISTORY_LIMIT), future: [], cues: updated }));
      } catch (error) {
        useAppStore.getState().reportError(error, 'Could not split that cue');
      }
    },

    async mergeSelected() {
      const { selection, trackId } = get();
      if (!trackId || selection.length < 2) {
        useAppStore.getState().notify({
          kind: 'info',
          title: 'Select two or more cues',
          message: 'Hold Ctrl or Shift to select the cues you want joined.',
        });
        return;
      }
      await get().flush();
      try {
        const { cues: updated } = await api.mergeCues(trackId, selection);
        set((state) => ({
          past: [...state.past, clone(state.cues)].slice(-HISTORY_LIMIT),
          future: [],
          cues: updated,
          selection: [],
        }));
      } catch (error) {
        useAppStore.getState().reportError(error, 'Could not merge those cues');
      }
    },

    async shiftAll(deltaMs) {
      const { trackId } = get();
      if (!trackId) return;
      await get().flush();
      try {
        const { cues: updated } = await api.shiftTrack(trackId, deltaMs);
        set((state) => ({ past: [...state.past, clone(state.cues)].slice(-HISTORY_LIMIT), future: [], cues: updated }));
      } catch (error) {
        useAppStore.getState().reportError(error, 'Could not shift the track');
      }
    },

    async resegment(maxChars, maxLines) {
      const { trackId } = get();
      if (!trackId) return;
      await get().flush();
      try {
        const { cues: updated } = await api.resegment(trackId, { maxCharsPerLine: maxChars, maxLines });
        set((state) => ({ past: [...state.past, clone(state.cues)].slice(-HISTORY_LIMIT), future: [], cues: updated }));
        void get().refreshQuality();
        useAppStore.getState().notify({ kind: 'success', title: `Re-cut into ${updated.length} cues` });
      } catch (error) {
        useAppStore.getState().reportError(error, 'Could not re-cut the captions');
      }
    },

    undo() {
      const { past, cues, future } = get();
      const previous = past[past.length - 1];
      if (!previous) return;
      set({ past: past.slice(0, -1), cues: previous, future: [clone(cues), ...future].slice(0, HISTORY_LIMIT), dirty: true });
      scheduleSave(0, 'undo');
    },

    redo() {
      const { past, cues, future } = get();
      const next = future[0];
      if (!next) return;
      set({ past: [...past, clone(cues)].slice(-HISTORY_LIMIT), cues: next, future: future.slice(1), dirty: true });
      scheduleSave(0, 'redo');
    },

    async flush() {
      window.clearTimeout(saveTimer);
      await save();
    },

    async refreshQuality() {
      const { trackId } = get();
      if (!trackId) return;
      try {
        set({ quality: await api.quality(trackId) });
      } catch {
        // A failed quality check is not worth interrupting the user over.
      }
    },
  };
});
