/**
 * The preload bridge.
 *
 * This is the only code with access to both Node and the page, so it exposes
 * the smallest useful surface: named functions, no `ipcRenderer`, no `require`,
 * no path strings the renderer could turn into arbitrary reads. Every call is
 * one handler in the main process.
 *
 * Written as CommonJS because a preload script runs before the module loader
 * does, and `sandbox: false` does not change that.
 */

import { contextBridge, ipcRenderer } from 'electron';

type Unsubscribe = () => void;

function subscribe(channel: string, handler: (...args: unknown[]) => void): Unsubscribe {
  const listener = (_event: unknown, ...args: unknown[]) => handler(...args);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

const api = {
  app: {
    info: () => ipcRenderer.invoke('app:info'),
    quit: () => ipcRenderer.invoke('app:quit'),
  },
  backend: {
    handle: () => ipcRenderer.invoke('backend:handle'),
    status: () => ipcRenderer.invoke('backend:status'),
    restart: () => ipcRenderer.invoke('backend:restart'),
    onStatus: (handler: (status: unknown) => void) =>
      subscribe('backend:status', (status) => handler(status)),
  },
  tools: {
    locate: (configured?: { ffmpeg?: string; ffprobe?: string }) =>
      ipcRenderer.invoke('tools:locate', configured),
    onMissing: (handler: (tools: unknown) => void) => subscribe('tools:missing', (tools) => handler(tools)),
  },
  dialog: {
    openVideos: () => ipcRenderer.invoke('dialog:openVideos'),
    openSubtitles: () => ipcRenderer.invoke('dialog:openSubtitles'),
    openProject: () => ipcRenderer.invoke('dialog:openProject'),
    chooseFolder: (title?: string) => ipcRenderer.invoke('dialog:chooseFolder', title),
    saveAs: (options: { title?: string; defaultPath?: string; extensions?: string[]; name?: string }) =>
      ipcRenderer.invoke('dialog:saveAs', options),
    confirm: (options: { title: string; message: string; detail?: string; confirmLabel?: string; danger?: boolean }) =>
      ipcRenderer.invoke('dialog:confirm', options),
  },
  files: {
    stat: (path: string) => ipcRenderer.invoke('fs:stat', path),
    readText: (path: string) => ipcRenderer.invoke('fs:readText', path),
    writeText: (path: string, contents: string) => ipcRenderer.invoke('fs:writeText', path, contents),
    reveal: (path: string) => ipcRenderer.invoke('shell:reveal', path),
    open: (path: string) => ipcRenderer.invoke('shell:open', path),
    openLogs: () => ipcRenderer.invoke('shell:openLogs'),
    openModelsFolder: () => ipcRenderer.invoke('shell:openModelsFolder'),
  },
  window: {
    control: (action: 'minimize' | 'maximize' | 'close' | 'fullscreen') =>
      ipcRenderer.invoke('window:control', action),
    state: () => ipcRenderer.invoke('window:state'),
  },
  menu: {
    onCommand: (handler: (command: string) => void) =>
      subscribe('menu:command', (command) => handler(command as string)),
  },
};

contextBridge.exposeInMainWorld('sf', api);

export type SubtitleForgeBridge = typeof api;
