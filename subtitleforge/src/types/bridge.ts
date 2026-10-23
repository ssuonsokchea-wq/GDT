/** The preload bridge, as the renderer sees it. */

export interface AppInfo {
  version: string;
  name: string;
  platform: 'win32' | 'darwin' | 'linux' | string;
  arch: string;
  electron: string;
  chrome: string;
  node: string;
  paths: { userData: string; logs: string; videos: string; downloads: string; documents: string };
  isPackaged: boolean;
}

export interface BackendHandle {
  host: string;
  port: number;
  token: string;
  dataDir: string;
  baseUrl: string;
}

export type BackendStatus =
  | { state: 'starting' }
  | { state: 'ready'; handle: BackendHandle }
  | { state: 'restarting'; attempt: number; reason: string }
  | { state: 'failed'; reason: string; detail?: string };

export interface ToolLocation {
  name: 'ffmpeg' | 'ffprobe';
  path: string | null;
  source: 'bundled' | 'configured' | 'path' | 'missing';
  version: string | null;
}

export interface FileStat {
  exists: boolean;
  sizeBytes?: number;
  isFile?: boolean;
  isDirectory?: boolean;
  modified?: string;
  name: string;
  dir: string;
  ext?: string;
}

export interface SubtitleForgeBridge {
  app: { info(): Promise<AppInfo>; quit(): Promise<void> };
  backend: {
    handle(): Promise<BackendHandle | null>;
    status(): Promise<BackendStatus>;
    restart(): Promise<BackendHandle>;
    onStatus(handler: (status: BackendStatus) => void): () => void;
  };
  tools: {
    locate(configured?: { ffmpeg?: string; ffprobe?: string }): Promise<Record<'ffmpeg' | 'ffprobe', ToolLocation>>;
    onMissing(handler: (tools: Record<'ffmpeg' | 'ffprobe', ToolLocation>) => void): () => void;
  };
  dialog: {
    openVideos(): Promise<string[]>;
    openSubtitles(): Promise<string | null>;
    openProject(): Promise<string | null>;
    chooseFolder(title?: string): Promise<string | null>;
    saveAs(options: { title?: string; defaultPath?: string; extensions?: string[]; name?: string }): Promise<string | null>;
    confirm(options: {
      title: string;
      message: string;
      detail?: string;
      confirmLabel?: string;
      danger?: boolean;
    }): Promise<boolean>;
  };
  files: {
    stat(path: string): Promise<FileStat>;
    readText(path: string): Promise<string>;
    writeText(path: string, contents: string): Promise<{ path: string; sizeBytes: number }>;
    reveal(path: string): Promise<void>;
    open(path: string): Promise<void>;
    openLogs(): Promise<void>;
    openModelsFolder(): Promise<void>;
  };
  window: {
    control(action: 'minimize' | 'maximize' | 'close' | 'fullscreen'): Promise<void>;
    state(): Promise<{ maximized: boolean; fullscreen: boolean }>;
  };
  menu: { onCommand(handler: (command: string) => void): () => void };
}

declare global {
  interface Window {
    sf: SubtitleForgeBridge;
  }
}
