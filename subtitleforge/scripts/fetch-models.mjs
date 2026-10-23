#!/usr/bin/env node
/**
 * Fetch Whisper models, once, deliberately.
 *
 * This is the only part of SubtitleForge that touches the network, it is a
 * separate command, and it is never run by the application. Point it at a
 * machine with a connection, then copy the models folder to the offline
 * machines that need it.
 *
 *   node scripts/fetch-models.mjs small medium
 *   node scripts/fetch-models.mjs --list
 *   node scripts/fetch-models.mjs --dest "D:\\models" small
 */

import { spawnSync } from 'node:child_process';
import { homedir, platform } from 'node:os';
import { join } from 'node:path';

const CATALOG = {
  tiny: { repo: 'Systran/faster-whisper-tiny', mb: 75 },
  base: { repo: 'Systran/faster-whisper-base', mb: 145 },
  small: { repo: 'Systran/faster-whisper-small', mb: 484 },
  medium: { repo: 'Systran/faster-whisper-medium', mb: 1530 },
  'large-v3': { repo: 'Systran/faster-whisper-large-v3', mb: 3090 },
};

function defaultModelsDir() {
  if (platform() === 'win32') {
    return join(process.env.APPDATA ?? join(homedir(), 'AppData', 'Roaming'), 'SubtitleForge', 'models');
  }
  if (platform() === 'darwin') {
    return join(homedir(), 'Library', 'Application Support', 'SubtitleForge', 'models');
  }
  return join(process.env.XDG_DATA_HOME ?? join(homedir(), '.local', 'share'), 'SubtitleForge', 'models');
}

const args = process.argv.slice(2);
if (args.includes('--list') || args.length === 0) {
  console.log('Models available:\n');
  for (const [name, entry] of Object.entries(CATALOG)) {
    console.log(`  ${name.padEnd(10)} ${String(entry.mb).padStart(5)} MB   ${entry.repo}`);
  }
  console.log(`\nThey will be written to:\n  ${defaultModelsDir()}`);
  console.log('\nUsage: node scripts/fetch-models.mjs small [medium ...] [--dest <folder>]');
  process.exit(0);
}

const destIndex = args.indexOf('--dest');
const dest = destIndex >= 0 ? args[destIndex + 1] : defaultModelsDir();
const wanted = args.filter((argument, index) => {
  if (argument.startsWith('--')) return false;
  if (destIndex >= 0 && index === destIndex + 1) return false;
  return true;
});

const unknown = wanted.filter((name) => !(name in CATALOG));
if (unknown.length > 0) {
  console.error(`Unknown model${unknown.length === 1 ? '' : 's'}: ${unknown.join(', ')}`);
  console.error(`Known: ${Object.keys(CATALOG).join(', ')}`);
  process.exit(1);
}

const python = process.env.SF_PYTHON ?? (platform() === 'win32' ? 'python' : 'python3');
const total = wanted.reduce((sum, name) => sum + CATALOG[name].mb, 0);
console.log(`Fetching ${wanted.length} model${wanted.length === 1 ? '' : 's'} (about ${total} MB) into:`);
console.log(`  ${dest}\n`);


for (const name of wanted) {
  const { repo, mb } = CATALOG[name];
  const target = join(dest, `faster-whisper-${name}`);
  console.log(`→ ${name} (${mb} MB) from ${repo}`);
  const result = spawnSync(
    python,
    [
      '-c',
      [
        'import sys',
        'from huggingface_hub import snapshot_download',
        'path = snapshot_download(sys.argv[1], local_dir=sys.argv[2],',
        '    allow_patterns=["*.bin", "*.json", "*.txt", "*.model"])',
        'print("saved to", path)',
      ].join('\n'),
      repo,
      target,
    ],
    { stdio: 'inherit' },
  );
  if (result.status !== 0) {
    console.error(`\nCould not fetch ${name}.`);
    console.error('Install the downloader first:  pip install huggingface_hub');
    console.error('Or download the files by hand from the repository above and put them in:');
    console.error(`  ${target}`);
    process.exit(1);
  }
}

console.log('\nDone. The models folder can now be copied to any offline machine.');
