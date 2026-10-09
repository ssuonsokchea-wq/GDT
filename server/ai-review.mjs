// Optional contextual review by Claude. OFF unless the server operator sets
// ANTHROPIC_API_KEY and KHMERPROOF_AI=on. The API key stays on the server.
//
// The model's output is never trusted directly. Each finding is kept only if:
//   - its "original" text occurs verbatim in the submitted text;
//   - its category is one KhmerProof knows;
//   - every suggested replacement passes KhmerProof's own spelling check;
// and its confidence is capped, so AI findings never outrank dictionary evidence.
// In legal mode every AI finding is marked for human review.

import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { analyze } from '../engine/analyzer.js';
import { makeFinding, CATEGORIES } from '../engine/finding.js';
import { locator } from '../engine/tokenize.js';

export const AI_MODEL = process.env.KHMERPROOF_AI_MODEL || 'claude-opus-5-5';
export const AI_MAX_CHARS = 6000;

export function aiEnabled() {
  return process.env.KHMERPROOF_AI === 'on' && !!(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
}

const ALLOWED = ['grammar', 'structure', 'wording', 'missing', 'unnecessary', 'clarity', 'spelling', 'punctuation', 'repetition', 'terminology'];

const ResultSchema = z.object({
  findings: z.array(z.object({
    original: z.string(),
    category: z.string(),
    suggestion: z.string(),
    explanation_km: z.string(),
    confidence: z.number(),
  })),
});

const JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['findings'],
  properties: {
    findings: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['original', 'category', 'suggestion', 'explanation_km', 'confidence'],
        properties: {
          original: { type: 'string', description: 'Exact substring of the input text that has the problem, copied character for character.' },
          category: { type: 'string', enum: ALLOWED },
          suggestion: { type: 'string', description: 'Replacement for the original substring. Empty string if no safe rewrite exists.' },
          explanation_km: { type: 'string', description: 'Short explanation in Khmer.' },
          confidence: { type: 'number', description: '0 to 1' },
        },
      },
    },
  },
};

const MODE_NOTES = {
  general: 'General writing.',
  academic: 'Academic writing: formal register, precise terminology.',
  government: 'Government writing: formal register used by Cambodian ministries.',
  administrative: 'Administrative letters and forms: formal, polite register.',
  legal: 'Legal text. Preserve the legal meaning exactly. Never propose a change that alters negation, obligation (ត្រូវ), permission (អាច), and/or, numbers, dates, parties, defined terms or cross-references. Report such issues with an empty suggestion.',
};

function systemPrompt(mode) {
  return `You are a careful proofreader of Modern Standard Khmer. You review text that a rule-based checker has already analysed with the Chuon Nath dictionary, so focus on contextual problems a dictionary cannot see: grammar, sentence structure, wrong word for the context, missing or unnecessary words, unclear sentences and inconsistent terminology.

Writing mode: ${MODE_NOTES[mode] || MODE_NOTES.general}

Report only problems you are confident a careful Khmer editor would agree with. Accepted variant spellings (e.g. ្ដ/្ត, ឲ្យ/ឱ្យ) and proper names are not errors. Copy each "original" exactly from the input so that it can be located. Keep each "original" as short as possible while still identifying the problem. Write each explanation in Khmer, in one or two sentences. Return an empty list if the text has no such problems.`;
}

/**
 * @param {string} text
 * @param {string} mode
 * @param {import('../engine/lexicon.js').Lexicon} lexicon
 */
export async function aiReview(text, mode, lexicon) {
  if (!aiEnabled()) throw Object.assign(new Error('AI review is not enabled on this server'), { status: 503 });
  if (text.length > AI_MAX_CHARS) throw Object.assign(new Error(`AI review accepts at most ${AI_MAX_CHARS} characters`), { status: 413 });
  const client = new Anthropic({ maxRetries: 1, timeout: 120000 });
  const response = await client.beta.messages.create({
    model: AI_MODEL,
    max_tokens: 16000,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    output_config: { effort: 'medium', format: { type: 'json_schema', schema: JSON_SCHEMA } },
    system: systemPrompt(mode),
    messages: [{ role: 'user', content: `<text>\n${text}\n</text>` }],
  });
  if (response.stop_reason === 'refusal') return { findings: [], note: 'The model declined to review this text.' };
  if (response.stop_reason === 'max_tokens') return { findings: [], note: 'The review was cut off; try a shorter text.' };
  const block = response.content.find(b => b.type === 'text');
  if (!block) return { findings: [], note: 'No result returned.' };
  let parsed;
  try { parsed = ResultSchema.parse(JSON.parse(block.text)); } catch { return { findings: [], note: 'The model returned an invalid result.' }; }
  return { findings: validate(text, mode, parsed.findings, lexicon), model: response.model, rejected: parsed.findings.length };
}

/** Keep only AI findings that can be located and whose suggestions pass the local checks. */
export function validate(text, mode, items, lexicon) {
  const loc = locator(text);
  const out = [];
  const used = new Set();
  for (const it of items) {
    if (!ALLOWED.includes(it.category) || !CATEGORIES[it.category]) continue;
    if (!it.original || it.original.length > 400) continue;
    let at = text.indexOf(it.original);
    while (at !== -1 && used.has(at)) at = text.indexOf(it.original, at + 1);
    if (at === -1) continue;
    let suggestions = it.suggestion && it.suggestion !== it.original ? [it.suggestion] : [];
    // reject suggestions that introduce spelling errors
    suggestions = suggestions.filter(s => !analyze(s, lexicon, { mode }).findings.some(f => f.category === 'spelling' && f.severity === 'error'));
    used.add(at);
    const f = makeFinding(text, {
      start: at, end: at + it.original.length, category: it.category, severity: 'suggestion',
      confidence: Math.min(0.6, Math.max(0.2, Number(it.confidence) || 0.4)),
      ruleId: 'ai.contextual', layer: 'context', title: 'សំណើពីការវិភាគបរិបទ (AI)',
      explanation: String(it.explanation_km).slice(0, 600),
      suggestions, source: 'ai', sourceDetail: AI_MODEL, autoFixSafe: false, humanReview: mode === 'legal',
    });
    f.location = loc(f.start);
    f.context = text.slice(Math.max(0, at - 40), Math.min(text.length, at + it.original.length + 40));
    f.contextOffset = at - Math.max(0, at - 40);
    if (mode === 'legal') f.legalNote = 'របៀបច្បាប់៖ សំណើពី AI ត្រូវតែពិនិត្យដោយអ្នកជំនាញ មុនទទួលយក។';
    out.push(f);
  }
  return out;
}
