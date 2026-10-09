// Node.js entry point: loads the bundled lexicon from disk.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Lexicon } from './lexicon.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let cached = null;
export function loadLexicon(file = path.join(ROOT, 'data', 'lexicon.json')) {
  if (!cached || file !== cached.file) cached = { file, lexicon: new Lexicon(JSON.parse(fs.readFileSync(file, 'utf8'))) };
  return cached.lexicon;
}
export * from './analyzer.js';
export { Lexicon, SRC } from './lexicon.js';
