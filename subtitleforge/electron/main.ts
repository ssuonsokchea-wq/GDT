/**
 * The main process.
 *
 * Responsibilities, in the order they happen: start the Python backend, create
 * one window with web security left on, wire the menu, and tear everything
 * down on quit. The renderer never gets Node integration — it talks to this
 * process through the narrow preload bridge and to the backend over loopback
 * HTTP with a per-launch token.
 */

import { join } from 'node:path';
import { BrowserWindow, app, dialog, ipcMain, shell } from 'electron';
import { registerIpc } from './ipc/handlers.js';
import { buildMenu, type MenuCommand } from './menu.js';
import { BackendProcess, type BackendStatus } from './services/backend.js';
import { locateTools } from './services/tools.js';
import { loadWindowState, trackWindowState, windowMinimum } from './services/windowState.js';

const isDevelopment = !app.isPackaged && process.env.NODE_ENV === 'development';
const DEV_SERVER = process.env.SF_DEV_SERVER ?? 'http://localhost:5273';

let mainWindow: BrowserWindow | null = null;
let backend: BackendProcess | null = null;

// A second instance would fight the first over the SQLite database and the
// backend port, so the second launch simply focuses the window already open.
if (!app.requestSingleInstanceLock()) {
  app.quit();
}

app.on('second-instance', () => {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.focus();
});

function createWindow(): BrowserWindow {
  const state = loadWindowState();
  const window = new BrowserWindow({
    width: state.width,
    height: state.height,
    ...(state.x !== undefined ? { x: state.x, y: state.y } : {}),
    minWidth: windowMinimum.width,
    minHeight: windowMinimum.height,
    show: false,
    backgroundColor: '#0A0C10',
    title: 'SubtitleForge AI',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    autoHideMenuBar: process.platform === 'win32',
    icon: join(app.getAppPath(), 'build', process.platform === 'win32' ? 'icon.ico' : 'icon.png'),
    webPreferences: {
      preload: join(import.meta.dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false, // the preload needs ipcRenderer; it exposes no Node to the page
      webSecurity: true,
      spellcheck: true,
    },
  });

  if (state.maximized) window.maximize();
  trackWindowState(window);

  window.once('ready-to-show', () => {
    window.show();
    if (isDevelopment) window.webContents.openDevTools({ mode: 'detach' });
  });

  // Nothing in this application should ever open a second window or navigate
  // away from the local bundle. Both are refused rather than handled.
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) void shell.openExternal(url);
    return { action: 'deny' };
  });
  window.webContents.on('will-navigate', (event, url) => {
    const allowed = isDevelopment ? url.startsWith(DEV_SERVER) : url.startsWith('file://');
    if (!allowed) event.preventDefault();
  });

  if (isDevelopment) {
    void window.loadURL(DEV_SERVER);
  } else {
    void window.loadFile(join(app.getAppPath(), 'dist', 'renderer', 'index.html'));
  }

  window.on('closed', () => {
    mainWindow = null;
  });

  return window;
}

function sendMenuCommand(command: MenuCommand): void {
  mainWindow?.webContents.send('menu:command', command);
}

function forwardBackendStatus(status: BackendStatus): void {
  mainWindow?.webContents.send('backend:status', status);
}

async function bootstrap(): Promise<void> {
  const tools = await locateTools();
  backend = new BackendProcess({
    ffmpeg: tools.ffmpeg.path ?? undefined,
    ffprobe: tools.ffprobe.path ?? undefined,
    maxJobs: 1,
  });
  backend.onStatus(forwardBackendStatus);
  registerIpc(backend);

  mainWindow = createWindow();
  buildMenu(mainWindow, sendMenuCommand);

  try {
    await backend.start();
  } catch (error) {
    // The window is already up, so the renderer can show this properly. The
    // dialog is the backstop for a failure before the renderer has loaded.
    const detail = error instanceof Error ? error.message : String(error);
    forwardBackendStatus({ state: 'failed', reason: 'The subtitle engine could not start.', detail });
    if (!mainWindow || mainWindow.isDestroyed()) {
      await dialog.showMessageBox({
        type: 'error',
        title: 'SubtitleForge AI',
        message: 'The subtitle engine could not start.',
        detail,
      });
      app.quit();
    }
  }

  if (tools.ffmpeg.source === 'missing') {
    mainWindow?.webContents.send('tools:missing', tools);
  }
}

app.whenReady().then(bootstrap).catch((error) => {
  console.error('startup failed', error);
  app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0 && backend) {
    mainWindow = createWindow();
    buildMenu(mainWindow, sendMenuCommand);
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

let shuttingDown = false;
app.on('before-quit', (event) => {
  if (shuttingDown || !backend) return;
  // Give the backend a chance to finish its current SQLite write; quitting
  // under a WAL checkpoint is how a project database gets truncated.
  shuttingDown = true;
  event.preventDefault();
  void backend.stop().finally(() => app.quit());
});

process.on('uncaughtException', (error) => {
  console.error('uncaught exception in main process', error);
});

ipcMain.handle('app:quit', () => app.quit());
