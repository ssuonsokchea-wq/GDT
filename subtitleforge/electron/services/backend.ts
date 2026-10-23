/**
 * The Python backend's lifecycle.
 *
 * The backend is a child process, not a service: it starts with the window,
 * dies with it, and listens only on loopback behind a token this process
 * generates. Three details make it reliable rather than merely working.
 *
 * 1. **A handshake, not a guess.** The backend prints one JSON line with its
 *    port and token once it is listening. Polling a hard-coded port instead
 *    produces the race every Electron-plus-sidecar app eventually hits.
 * 2. **Supervision.** If the process dies while the app is running, it is
 *    restarted with backoff and the renderer is told, so a crash during a long
 *    render becomes a visible message instead of a frozen progress bar.
 * 3. **Nothing leaks.** The token lives in this process and the preload
 *    bridge. The renderer receives it through a function call, never a file.
 */

import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { appendFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { app } from 'electron';

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

type Listener = (status: BackendStatus) => void;

const MAX_RESTARTS = 5;
const START_TIMEOUT_MS = 60_000;

export class BackendProcess {
  private child: ChildProcessWithoutNullStreams | null = null;
  private handle: BackendHandle | null = null;
  private listeners = new Set<Listener>();
  private restarts = 0;
  private stopping = false;
  private status: BackendStatus = { state: 'starting' };
  private logPath: string;

  constructor(private readonly options: { ffmpeg?: string; ffprobe?: string; maxJobs?: number } = {}) {
    this.logPath = join(app.getPath('logs'), 'backend-launcher.log');
  }

  onStatus(listener: Listener): () => void {
    this.listeners.add(listener);
    listener(this.status);
    return () => this.listeners.delete(listener);
  }

  current(): BackendStatus {
    return this.status;
  }

  getHandle(): BackendHandle | null {
    return this.handle;
  }

  async start(): Promise<BackendHandle> {
    this.stopping = false;
    this.emit({ state: 'starting' });
    const token = randomBytes(32).toString('base64url');
    const { command, args, cwd } = this.resolveLauncher();
    await this.log(`launching: ${command} ${args.join(' ')}`);

    const child = spawn(command, args, {
      cwd,
      env: {
        ...process.env,
        SF_TOKEN: token,
        SF_DATA_DIR: app.getPath('userData'),
        SF_MAX_JOBS: String(this.options.maxJobs ?? 1),
        ...(this.options.ffmpeg ? { SF_FFMPEG: this.options.ffmpeg } : {}),
        ...(this.options.ffprobe ? { SF_FFPROBE: this.options.ffprobe } : {}),
        PYTHONUNBUFFERED: '1',
        // Belt and braces: even if application code asked, the hub cannot fetch.
        HF_HUB_OFFLINE: '1',
        TRANSFORMERS_OFFLINE: '1',
      },
      windowsHide: true,
    });
    this.child = child;

    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => {
      void this.log(`[stderr] ${chunk.trimEnd()}`);
    });

    const handle = await this.awaitHandshake(child, token);
    this.handle = handle;
    this.restarts = 0;
    this.emit({ state: 'ready', handle });

    child.on('exit', (code, signal) => {
      void this.log(`backend exited code=${code} signal=${signal}`);
      this.child = null;
      this.handle = null;
      if (this.stopping) return;
      void this.restart(`The backend stopped unexpectedly (exit ${code ?? signal}).`);
    });

    return handle;
  }

  private awaitHandshake(child: ChildProcessWithoutNullStreams, token: string): Promise<BackendHandle> {
    return new Promise((resolve, reject) => {
      let buffer = '';
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        child.kill();
        reject(new Error('The backend did not start within 60 seconds.'));
      }, START_TIMEOUT_MS);

      child.stdout.setEncoding('utf8');
      child.stdout.on('data', (chunk: string) => {
        buffer += chunk;
        let newline = buffer.indexOf('\n');
        while (newline >= 0) {
          const line = buffer.slice(0, newline).trim();
          buffer = buffer.slice(newline + 1);
          newline = buffer.indexOf('\n');
          if (!line.startsWith('{')) continue;
          try {
            const message = JSON.parse(line) as { event?: string; host?: string; port?: number; dataDir?: string };
            if (message.event === 'ready' && message.port) {
              if (settled) return;
              settled = true;
              clearTimeout(timer);
              resolve({
                host: message.host ?? '127.0.0.1',
                port: message.port,
                token,
                dataDir: message.dataDir ?? app.getPath('userData'),
                baseUrl: `http://${message.host ?? '127.0.0.1'}:${message.port}`,
              });
              return;
            }
          } catch {
            // Not our handshake line; backend logging is free to use stdout.
          }
        }
      });

      child.on('error', (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(error);
      });
    });
  }

  /**
   * Where the backend lives.
   *
   * Packaged builds run a PyInstaller executable next to the app's resources.
   * Development runs the module from the repository with whatever Python is on
   * the path — which is also the fallback if the bundled binary is missing, so
   * a broken package degrades to a clear Python error instead of silence.
   */
  private resolveLauncher(): { command: string; args: string[]; cwd: string } {
    const exeName = process.platform === 'win32' ? 'subtitleforge-backend.exe' : 'subtitleforge-backend';
    const packaged = join(process.resourcesPath ?? '', 'backend', exeName);
    if (app.isPackaged && existsSync(packaged)) {
      return { command: packaged, args: [], cwd: dirname(packaged) };
    }
    const repoBackend = join(app.getAppPath(), 'backend');
    const python = process.env.SF_PYTHON ?? (process.platform === 'win32' ? 'python' : 'python3');
    return { command: python, args: ['-m', 'subtitleforge'], cwd: repoBackend };
  }

  private async restart(reason: string): Promise<void> {
    if (this.restarts >= MAX_RESTARTS) {
      this.emit({
        state: 'failed',
        reason: 'The backend keeps stopping.',
        detail: `${reason} See backend.log in the application's logs folder.`,
      });
      return;
    }
    this.restarts += 1;
    this.emit({ state: 'restarting', attempt: this.restarts, reason });
    // Linear backoff: a fast first retry covers a transient port clash, while
    // later waits stop a crash loop from burning the machine.
    await new Promise((resolve) => setTimeout(resolve, this.restarts * 1000));
    try {
      await this.start();
    } catch (error) {
      this.emit({ state: 'failed', reason: 'The backend could not be started.', detail: String(error) });
    }
  }

  async stop(): Promise<void> {
    this.stopping = true;
    const child = this.child;
    if (!child) return;
    child.kill();
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        // A render in flight can hold the process; after five seconds, insist.
        try {
          child.kill('SIGKILL');
        } catch {
          /* already gone */
        }
        resolve();
      }, 5000);
      child.once('exit', () => {
        clearTimeout(timer);
        resolve();
      });
    });
    this.child = null;
    this.handle = null;
  }

  private emit(status: BackendStatus): void {
    this.status = status;
    for (const listener of this.listeners) listener(status);
  }

  private async log(line: string): Promise<void> {
    try {
      await mkdir(dirname(this.logPath), { recursive: true });
      await appendFile(this.logPath, `${new Date().toISOString()} ${line}\n`, 'utf8');
    } catch {
      /* logging must never break startup */
    }
  }
}
