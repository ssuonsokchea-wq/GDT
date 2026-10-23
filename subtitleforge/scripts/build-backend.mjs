#!/usr/bin/env node
/**
 * Freeze the Python backend into a single executable.
 *
 * The Windows installer must not require Python. PyInstaller bundles the
 * interpreter, Faster-Whisper and CTranslate2 into one binary that the Electron
 * main process launches exactly as it launches `python -m subtitleforge` in
 * development — same handshake, same flags, so there is one code path.
 *
 * Model weights are deliberately NOT bundled: large-v3 alone is 3 GB, and an
 * installer that size is hostile. They are installed separately, which also
 * keeps the download honest about what it is fetching.
 */

import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const backend = join(root, 'backend');
const output = join(root, 'resources', 'backend');
const python = process.env.SF_PYTHON ?? (process.platform === 'win32' ? 'python' : 'python3');

function run(command, args, options = {}) {
  console.log(`> ${command} ${args.join(' ')}`);
  const result = spawnSync(command, args, { stdio: 'inherit', cwd: backend, ...options });
  if (result.status !== 0) {
    throw new Error(`${command} exited with ${result.status ?? 'a signal'}`);
  }
}

function ensurePyInstaller() {
  try {
    execFileSync(python, ['-m', 'PyInstaller', '--version'], { stdio: 'ignore' });
  } catch {
    console.log('PyInstaller is not installed in this Python environment.');
    run(python, ['-m', 'pip', 'install', 'pyinstaller==6.11.1']);
  }
}

function build() {
  ensurePyInstaller();
  rmSync(join(backend, 'build'), { recursive: true, force: true });
  rmSync(join(backend, 'dist'), { recursive: true, force: true });
  mkdirSync(output, { recursive: true });

  run(python, [
    '-m',
    'PyInstaller',
    '--noconfirm',
    '--clean',
    '--name',
    'subtitleforge-backend',
    '--onedir', // one directory, not one file: a 300 MB onefile unpacks to temp
    //            on every launch, which adds seconds to startup.
    '--console',
    // The schema travels with the binary; without it the first launch cannot
    // create its database.
    '--add-data',
    `${join('subtitleforge', 'db', 'schema.sql')}${process.platform === 'win32' ? ';' : ':'}${join('subtitleforge', 'db')}`,
    // CTranslate2 and faster-whisper load parts of themselves dynamically, so
    // PyInstaller's static analysis misses them.
    '--collect-all',
    'ctranslate2',
    '--collect-all',
    'faster_whisper',
    '--collect-submodules',
    'uvicorn',
    '--collect-submodules',
    'encodings',
    '--hidden-import',
    'uvicorn.logging',
    '--hidden-import',
    'uvicorn.loops.auto',
    '--hidden-import',
    'uvicorn.protocols.http.auto',
    '--hidden-import',
    'uvicorn.lifespan.on',
    '--exclude-module',
    'tkinter',
    '--exclude-module',
    'matplotlib',
    '--distpath',
    output,
    join('subtitleforge', '__main__.py'),
  ]);

  const binary = join(
    output,
    'subtitleforge-backend',
    process.platform === 'win32' ? 'subtitleforge-backend.exe' : 'subtitleforge-backend',
  );
  if (!existsSync(binary)) {
    throw new Error(`PyInstaller did not produce ${binary}`);
  }
  console.log(`\nBackend built: ${binary}`);
  console.log('Smoke-testing the frozen binary…');
  const probe = spawnSync(binary, ['--help'], { encoding: 'utf8', timeout: 120_000 });
  if (probe.status !== 0) {
    throw new Error(`The frozen backend failed to run:\n${probe.stderr ?? ''}`);
  }
  console.log('The frozen backend starts correctly.');
}

try {
  build();
} catch (error) {
  console.error(`\nBackend build failed: ${error.message}`);
  process.exit(1);
}
