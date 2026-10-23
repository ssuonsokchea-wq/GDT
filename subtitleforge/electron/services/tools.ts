/**
 * Finding FFmpeg.
 *
 * The Windows installer ships FFmpeg beside the app, which is the only way to
 * promise a working render on a fresh machine. Everywhere else we look for a
 * bundled copy first, then a user-configured path, then the system PATH — and
 * report what we found, because "FFmpeg not found" is the single most common
 * first-run failure in this category of application.
 */

import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { app } from 'electron';

const run = promisify(execFile);

export interface ToolLocation {
  name: 'ffmpeg' | 'ffprobe';
  path: string | null;
  source: 'bundled' | 'configured' | 'path' | 'missing';
  version: string | null;
}

function bundledDir(): string {
  return app.isPackaged
    ? join(process.resourcesPath ?? '', 'bin')
    : join(app.getAppPath(), 'resources', 'bin');
}

function executable(name: string): string {
  return process.platform === 'win32' ? `${name}.exe` : name;
}

export async function locateTool(name: 'ffmpeg' | 'ffprobe', configured?: string): Promise<ToolLocation> {
  const candidates: Array<{ path: string; source: ToolLocation['source'] }> = [];
  const bundled = join(bundledDir(), executable(name));
  if (existsSync(bundled)) candidates.push({ path: bundled, source: 'bundled' });
  if (configured && existsSync(configured)) candidates.push({ path: configured, source: 'configured' });
  candidates.push({ path: name, source: 'path' });

  for (const candidate of candidates) {
    try {
      const { stdout } = await run(candidate.path, ['-version'], { timeout: 10_000 });
      return {
        name,
        path: candidate.path,
        source: candidate.source,
        version: stdout.split('\n')[0]?.trim() ?? null,
      };
    } catch {
      // Try the next candidate.
    }
  }
  return { name, path: null, source: 'missing', version: null };
}

export async function locateTools(configured?: { ffmpeg?: string; ffprobe?: string }) {
  const [ffmpeg, ffprobe] = await Promise.all([
    locateTool('ffmpeg', configured?.ffmpeg),
    locateTool('ffprobe', configured?.ffprobe),
  ]);
  return { ffmpeg, ffprobe };
}
