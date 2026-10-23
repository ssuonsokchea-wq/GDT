/**
 * The IPC surface.
 *
 * Everything the renderer cannot do under its own security policy lives here:
 * native dialogs, reading a file the user picked, revealing an output in the
 * file manager, and the handshake that gives the renderer the backend's
 * address. The list is deliberately short and each handler validates its own
 * arguments, because this is the boundary where a compromised renderer would
 * otherwise reach the filesystem.
 */

import { readFile, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, extname, join } from 'node:path';
import { BrowserWindow, app, dialog, ipcMain, shell } from 'electron';
import type { BackendProcess } from '../services/backend.js';
import { locateTools } from '../services/tools.js';

const VIDEO_EXTENSIONS = ['mp4', 'mov', 'mkv', 'avi', 'webm', 'm4v', 'mpg', 'mpeg', 'wmv', 'flv'];
const SUBTITLE_EXTENSIONS = ['srt', 'vtt', 'ass', 'ssa'];
const PROJECT_EXTENSION = 'sfproj';

/** Paths the renderer may read or write. Anything else is refused. */
function assertSafePath(value: unknown): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error('A file path is required.');
  }
  if (value.includes('\u0000')) {
    throw new Error('Invalid file path.');
  }
  return value;
}

export function registerIpc(backend: BackendProcess): void {
  ipcMain.handle('app:info', () => ({
    version: app.getVersion(),
    name: app.getName(),
    platform: process.platform,
    arch: process.arch,
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
    paths: {
      userData: app.getPath('userData'),
      logs: app.getPath('logs'),
      videos: app.getPath('videos'),
      downloads: app.getPath('downloads'),
      documents: app.getPath('documents'),
    },
    isPackaged: app.isPackaged,
  }));

  ipcMain.handle('backend:handle', () => backend.getHandle());
  ipcMain.handle('backend:status', () => backend.current());
  ipcMain.handle('backend:restart', async () => {
    await backend.stop();
    return backend.start();
  });

  ipcMain.handle('tools:locate', async (_event, configured?: { ffmpeg?: string; ffprobe?: string }) =>
    locateTools(configured),
  );

  ipcMain.handle('dialog:openVideos', async (event) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    const result = await dialog.showOpenDialog(window!, {
      title: 'Import video',
      properties: ['openFile', 'multiSelections'],
      filters: [
        { name: 'Video', extensions: VIDEO_EXTENSIONS },
        { name: 'All files', extensions: ['*'] },
      ],
    });
    return result.canceled ? [] : result.filePaths;
  });

  ipcMain.handle('dialog:openSubtitles', async (event) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    const result = await dialog.showOpenDialog(window!, {
      title: 'Import subtitles',
      properties: ['openFile'],
      filters: [{ name: 'Subtitles', extensions: SUBTITLE_EXTENSIONS }],
    });
    return result.canceled ? null : (result.filePaths[0] ?? null);
  });

  ipcMain.handle('dialog:openProject', async (event) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    const result = await dialog.showOpenDialog(window!, {
      title: 'Open project',
      properties: ['openFile'],
      filters: [{ name: 'SubtitleForge project', extensions: [PROJECT_EXTENSION] }],
    });
    return result.canceled ? null : (result.filePaths[0] ?? null);
  });

  ipcMain.handle('dialog:chooseFolder', async (event, title?: string) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    const result = await dialog.showOpenDialog(window!, {
      title: title ?? 'Choose folder',
      properties: ['openDirectory', 'createDirectory'],
    });
    return result.canceled ? null : (result.filePaths[0] ?? null);
  });

  ipcMain.handle(
    'dialog:saveAs',
    async (event, options: { title?: string; defaultPath?: string; extensions?: string[]; name?: string }) => {
      const window = BrowserWindow.fromWebContents(event.sender);
      const result = await dialog.showSaveDialog(window!, {
        title: options.title ?? 'Save',
        defaultPath: options.defaultPath,
        filters: options.extensions?.length
          ? [{ name: options.name ?? 'File', extensions: options.extensions }]
          : undefined,
      });
      return result.canceled ? null : (result.filePath ?? null);
    },
  );

  ipcMain.handle('fs:stat', async (_event, path: unknown) => {
    const safe = assertSafePath(path);
    try {
      const info = await stat(safe);
      return {
        exists: true,
        sizeBytes: info.size,
        isFile: info.isFile(),
        isDirectory: info.isDirectory(),
        modified: info.mtime.toISOString(),
        name: basename(safe),
        dir: dirname(safe),
        ext: extname(safe).replace('.', '').toLowerCase(),
      };
    } catch {
      return { exists: false, name: basename(safe), dir: dirname(safe) };
    }
  });

  /** Reads a text file the user chose — subtitles and project bundles only. */
  ipcMain.handle('fs:readText', async (_event, path: unknown) => {
    const safe = assertSafePath(path);
    const extension = extname(safe).replace('.', '').toLowerCase();
    if (![...SUBTITLE_EXTENSIONS, PROJECT_EXTENSION, 'json', 'txt'].includes(extension)) {
      throw new Error(`Refusing to read a .${extension} file.`);
    }
    const info = await stat(safe);
    if (info.size > 32 * 1024 * 1024) {
      throw new Error('That file is larger than 32 MB.');
    }
    return readFile(safe, 'utf8');
  });

  ipcMain.handle('fs:writeText', async (_event, path: unknown, contents: unknown) => {
    const safe = assertSafePath(path);
    if (typeof contents !== 'string') throw new Error('Nothing to write.');
    await writeFile(safe, contents, 'utf8');
    return { path: safe, sizeBytes: Buffer.byteLength(contents, 'utf8') };
  });

  ipcMain.handle('shell:reveal', (_event, path: unknown) => {
    shell.showItemInFolder(assertSafePath(path));
  });

  ipcMain.handle('shell:open', async (_event, path: unknown) => {
    const error = await shell.openPath(assertSafePath(path));
    if (error) throw new Error(error);
  });

  ipcMain.handle('shell:openLogs', async () => {
    const error = await shell.openPath(app.getPath('logs'));
    if (error) throw new Error(error);
  });

  ipcMain.handle('shell:openModelsFolder', async () => {
    const folder = join(app.getPath('userData'), 'models');
    const error = await shell.openPath(folder);
    if (error) throw new Error(error);
  });

  ipcMain.handle('window:control', (event, action: 'minimize' | 'maximize' | 'close' | 'fullscreen') => {
    const window = BrowserWindow.fromWebContents(event.sender);
    if (!window) return;
    if (action === 'minimize') window.minimize();
    if (action === 'close') window.close();
    if (action === 'maximize') (window.isMaximized() ? window.unmaximize() : window.maximize());
    if (action === 'fullscreen') window.setFullScreen(!window.isFullScreen());
  });

  ipcMain.handle('window:state', (event) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    return { maximized: window?.isMaximized() ?? false, fullscreen: window?.isFullScreen() ?? false };
  });

  ipcMain.handle(
    'dialog:confirm',
    async (event, options: { title: string; message: string; detail?: string; confirmLabel?: string; danger?: boolean }) => {
      const window = BrowserWindow.fromWebContents(event.sender);
      const result = await dialog.showMessageBox(window!, {
        type: options.danger ? 'warning' : 'question',
        title: options.title,
        message: options.message,
        detail: options.detail,
        buttons: [options.confirmLabel ?? 'Continue', 'Cancel'],
        defaultId: 0,
        cancelId: 1,
        noLink: true,
      });
      return result.response === 0;
    },
  );
}

export const fileFilters = { VIDEO_EXTENSIONS, SUBTITLE_EXTENSIONS, PROJECT_EXTENSION };
