// The finding record shared by every layer, plus category and level vocabularies.

import { sourceRef } from './sources.js';

export const CATEGORIES = {
  spelling: { km: 'អក្ខរាវិរុទ្ធ', en: 'Spelling' },
  grammar: { km: 'វេយ្យាករណ៍', en: 'Grammar' },
  structure: { km: 'រចនាសម្ព័ន្ធល្បះ', en: 'Sentence structure' },
  wording: { km: 'ការជ្រើសរើសពាក្យ', en: 'Word choice' },
  missing: { km: 'ខ្វះពាក្យ', en: 'Missing word' },
  unnecessary: { km: 'ពាក្យលើស', en: 'Unnecessary word' },
  punctuation: { km: 'វណ្ណយុត្តិ និងដកឃ្លា', en: 'Punctuation and spacing' },
  repetition: { km: 'ពាក្យដដែលៗ', en: 'Repetition' },
  clarity: { km: 'ភាពច្បាស់លាស់', en: 'Clarity' },
  terminology: { km: 'ភាពស៊ីសង្វាក់នៃពាក្យបច្ចេកទេស', en: 'Terminology consistency' },
  unicode: { km: 'ការអ៊ិនកូដយូនីកូដ', en: 'Unicode encoding' },
  unverified: { km: 'ពាក្យមិនមានក្នុងវចនានុក្រម', en: 'Word not in dictionary' },
};

export const SEVERITIES = {
  error: { km: 'កំហុស', en: 'Error', rank: 0 },
  warning: { km: 'គួរពិនិត្យ', en: 'Warning', rank: 1 },
  suggestion: { km: 'សំណើកែលម្អ', en: 'Suggestion', rank: 2 },
  info: { km: 'ព័ត៌មាន', en: 'Information', rank: 3 },
};

export function confidenceLevel(c) { return c >= 0.8 ? 'high' : c >= 0.55 ? 'medium' : 'low'; }
export const CONFIDENCE_KM = { high: 'ខ្ពស់', medium: 'មធ្យម', low: 'ទាប' };
export const CONFIDENCE_VALUE = { high: 0.85, medium: 0.65, low: 0.4 };

/**
 * Create a finding. `suggestions` is ordered best first; an empty list means
 * the finding is advisory and cannot be applied automatically.
 */
export function makeFinding(text, f) {
  const confidence = typeof f.confidence === 'string' ? CONFIDENCE_VALUE[f.confidence] : f.confidence;
  const suggestions = (f.suggestions || []).filter((s, i, a) => s !== null && s !== undefined && a.indexOf(s) === i);
  return {
    start: f.start,
    end: f.end,
    original: text.slice(f.start, f.end),
    category: f.category,
    severity: f.severity || 'warning',
    confidence: Math.round(Math.max(0.05, Math.min(0.99, confidence)) * 100) / 100,
    confidenceLevel: confidenceLevel(confidence),
    ruleId: f.ruleId,
    layer: f.layer,
    title: f.title,
    explanation: f.explanation,
    suggestions,
    source: sourceRef(f.source, f.sourceDetail),
    autoFixSafe: f.autoFixSafe ?? false,
    humanReview: f.humanReview ?? false,
  };
}
