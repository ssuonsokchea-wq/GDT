/**
 * Application-wide state: the backend connection, machine capabilities,
 * notifications and which panels are open.
 *
 * Capabilities are fetched once per launch and shown throughout the UI, because
 * almost every "why can I not do this?" in an offline AI application has a
 * hardware answer: no GPU, no model installed, no FFmpeg.
 */

import { create } from 'zustand';
import { api, setBackendHandle } from '@/lib/api';
import { eventStream } from '@/lib/events';
import type { Capabilities } from '@/types/api';
import type { AppInfo, BackendStatus, ToolLocation } from '@/types/bridge';

export type ToastKind = 'info' | 'success' | 'warn' | 'error';

export interface Toast {
  id: string;
  kind: ToastKind;
  title: string;
  message?: string;
  hint?: string | null;
  action?: { label: string; run: () => void };
  createdAt: number;
  sticky?: boolean;
}

export type DialogName =
  | 'transcribe'
  | 'export'
  | 'render'
  | 'settings'
  | 'batch'
  | 'shortcuts'
  | 'about'
  | 'projects'
  | null;

interface AppState {
  info: AppInfo | null;
  backend: BackendStatus;
  streamConnected: boolean;
  capabilities: Capabilities | null;
  tools: Record<'ffmpeg' | 'ffprobe', ToolLocation> | null;
  toasts: Toast[];
  dialog: DialogName;
  rightPanelTab: 'editor' | 'style' | 'quality';
  timelineHeight: number;
  initialising: boolean;

  initialise: () => Promise<void>;
  setBackendStatus: (status: BackendStatus) => void;
  refreshCapabilities: () => Promise<void>;
  notify: (toast: Omit<Toast, 'id' | 'createdAt'>) => string;
  dismiss: (id: string) => void;
  reportError: (error: unknown, title?: string) => void;
  openDialog: (dialog: DialogName) => void;
  setRightPanelTab: (tab: 'editor' | 'style' | 'quality') => void;
  setTimelineHeight: (height: number) => void;
}

export const useAppStore = create<AppState>((set, get) => ({
  info: null,
  backend: { state: 'starting' },
  streamConnected: false,
  capabilities: null,
  tools: null,
  toasts: [],
  dialog: null,
  rightPanelTab: 'editor',
  timelineHeight: 232,
  initialising: true,

  async initialise() {
    const [info, status] = await Promise.all([window.sf.app.info(), window.sf.backend.status()]);
    set({ info });
    window.sf.backend.onStatus((next) => get().setBackendStatus(next));
    window.sf.tools.onMissing((tools) => {
      set({ tools: tools as Record<'ffmpeg' | 'ffprobe', ToolLocation> });
      get().notify({
        kind: 'error',
        title: 'FFmpeg was not found',
        message: 'Audio extraction, waveforms and burning subtitles all need it.',
        hint: 'Install FFmpeg and restart, or set its location in Settings → Tools.',
        sticky: true,
      });
    });
    eventStream.onConnectionChange((connected) => set({ streamConnected: connected }));
    get().setBackendStatus(status);
    set({ initialising: false });
  },

  setBackendStatus(status) {
    set({ backend: status });
    if (status.state === 'ready') {
      setBackendHandle(status.handle);
      eventStream.start();
      void get().refreshCapabilities();
    } else {
      setBackendHandle(null);
      if (status.state === 'failed') {
        get().notify({
          kind: 'error',
          title: status.reason,
          message: status.detail,
          hint: 'Open the logs folder from Help for the backend trace.',
          sticky: true,
        });
      }
    }
  },

  async refreshCapabilities() {
    try {
      const [capabilities, tools] = await Promise.all([api.capabilities(), window.sf.tools.locate()]);
      set({ capabilities, tools: tools as Record<'ffmpeg' | 'ffprobe', ToolLocation> });
      if (!capabilities.asr.models.some((model) => model.installed)) {
        get().notify({
          kind: 'warn',
          title: 'No speech model is installed',
          message: 'Subtitle generation needs at least one Whisper model on this machine.',
          hint: 'Settings → Models shows where to put them and how large each one is.',
          action: { label: 'Open Settings', run: () => get().openDialog('settings') },
          sticky: true,
        });
      }
    } catch (error) {
      get().reportError(error, 'Could not read this machine’s capabilities');
    }
  },

  notify(toast) {
    const id = `t${Date.now()}${Math.random().toString(36).slice(2, 7)}`;
    set((state) => ({ toasts: [...state.toasts, { ...toast, id, createdAt: Date.now() }] }));
    if (!toast.sticky) {
      window.setTimeout(() => get().dismiss(id), toast.kind === 'error' ? 9000 : 4500);
    }
    return id;
  },

  dismiss(id) {
    set((state) => ({ toasts: state.toasts.filter((toast) => toast.id !== id) }));
  },

  reportError(error, title) {
    const failure = error as { code?: string; message?: string; hint?: string | null };
    get().notify({
      kind: 'error',
      title: title ?? 'Something went wrong',
      message: failure?.message ?? String(error),
      hint: failure?.hint ?? null,
    });
  },

  openDialog(dialog) {
    set({ dialog });
  },

  setRightPanelTab(rightPanelTab) {
    set({ rightPanelTab });
  },

  setTimelineHeight(height) {
    set({ timelineHeight: Math.max(150, Math.min(520, Math.round(height))) });
  },
}));
