// Stores the Anthropic API key on the computer running KhmerProof, in a file git ignores.
// The key is never sent to the browser: the page only learns whether a key exists and its
// last four characters. Only requests from this computer (loopback) may change it.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = () => process.env.KHMERPROOF_LOCAL_DIR || path.join(ROOT, 'local');
const file = () => path.join(dir(), 'api-key.txt');
export const KEY_PATTERN = /^sk-ant-[A-Za-z0-9_-]{20,}$/;

function storedKey() {
  try {
    const k = fs.readFileSync(file(), 'utf8').trim();
    return KEY_PATTERN.test(k) ? k : null;
  } catch {
    return null;
  }
}

/** The key in use: an environment variable wins, then the file saved from the app. */
export function currentKey() {
  return process.env.ANTHROPIC_API_KEY || storedKey();
}

export function keyHint() {
  const k = currentKey();
  return k ? k.slice(-4) : null;
}

export function saveKey(key) {
  if (!KEY_PATTERN.test(key)) {
    throw Object.assign(new Error('That does not look like an Anthropic API key. It starts with sk-ant-.'), { status: 400 });
  }
  fs.mkdirSync(dir(), { recursive: true, mode: 0o700 });
  fs.writeFileSync(file(), key, { mode: 0o600 });
}

export function deleteKey() {
  fs.rmSync(file(), { force: true });
}

export function isLoopback(req) {
  const a = req.socket.remoteAddress || '';
  return a === '127.0.0.1' || a === '::1' || a === '::ffff:127.0.0.1';
}
