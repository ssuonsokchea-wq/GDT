// Runs the KhmerProof engine off the main thread so typing stays responsive.
import { Lexicon, SRC } from './engine/lexicon.js';
import { analyze } from './engine/analyzer.js';

let lexicon = null;
const extra = { user: [], nckl: [] };

async function init(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  lexicon = new Lexicon(await res.json());
  return lexicon;
}

self.onmessage = async ({ data }) => {
  try {
    if (data.type === 'init') {
      await init(data.lexiconUrl);
      if (data.userWords?.length) extra.user = data.userWords, lexicon.addWords(data.userWords, SRC.USER);
      if (data.ncklWords?.length) extra.nckl = data.ncklWords, lexicon.addWords(data.ncklWords, SRC.NCKL);
      self.postMessage({ type: 'ready', entries: lexicon.size, meta: lexicon.meta });
    } else if (data.type === 'words') {
      // Re-create the lexicon so removed words disappear as well.
      lexicon = null;
      await init(data.lexiconUrl);
      lexicon.addWords(data.userWords || [], SRC.USER);
      lexicon.addWords(data.ncklWords || [], SRC.NCKL);
      self.postMessage({ type: 'ready', entries: lexicon.size, meta: lexicon.meta });
    } else if (data.type === 'analyze') {
      if (!lexicon) throw new Error('Lexicon not loaded');
      const options = { ...data.options, ignoreWords: new Set(data.options.ignoreWords || []) };
      const result = analyze(data.text, lexicon, options);
      self.postMessage({ type: 'result', id: data.id, result });
    } else if (data.type === 'check-words') {
      // Used to validate AI suggestions and to tell whether a word is known.
      self.postMessage({ type: 'known', id: data.id, known: data.words.map(w => lexicon?.has(w) ?? false) });
    }
  } catch (e) {
    self.postMessage({ type: 'error', id: data.id, message: e.message });
  }
};
