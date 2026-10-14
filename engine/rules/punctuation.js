// Punctuation and spacing.

import { makeFinding } from '../finding.js';

export function checkPunctuation(ctx) {
  const { text, sentences, options } = ctx;
  const out = [];
  const add = f => out.push(makeFinding(text, { layer: 'punctuation', category: 'punctuation', source: 'project-style', ...f }));

  // Latin full stop ending a Khmer sentence (not an abbreviation such as គ.ស. or ព.ស.)
  for (const m of text.matchAll(/([\u1780-\u17DD]{3,})\.(?=[ \t]*(?:\n|$|[\u1780-\u17FF]))/gu)) {
    const at = m.index + m[1].length;
    if (/\.[\u1780-\u17DD]{1,2}$/u.test(text.slice(Math.max(0, m.index - 3), at))) continue;
    add({ start: at, end: at + 1, severity: 'warning', confidence: 0.75, ruleId: 'punct.latin-period',
      title: 'ប្រើខណ្ឌសញ្ញាខ្មែរ',
      explanation: 'ល្បះខ្មែរបញ្ចប់ដោយខណ្ឌសញ្ញា «។» មិនមែនចំណុចឡាតាំង «.» ទេ។', suggestions: ['។'], autoFixSafe: true });
  }
  // Latin colon after Khmer word → ៖
  for (const m of text.matchAll(/([\u1780-\u17DD])[ \t]?:(?=[ \t]*(?:\n|$|[\u1780-\u17FF]|[-\u2022]))/gu)) {
    const at = m.index + m[0].length - 1;
    add({ start: at, end: at + 1, severity: 'suggestion', confidence: 0.6, ruleId: 'punct.latin-colon',
      title: 'ប្រើចំណុចពីរគូសខ្មែរ',
      explanation: 'ក្នុងអត្ថបទខ្មែរ សញ្ញា «៖» (ចំណុចពីរគូស) ជាធម្មតាប្រើនៅមុខការរាប់រៀប ឬការដកស្រង់ ជំនួសឱ្យ «:»។', suggestions: ['៖'], autoFixSafe: true });
  }
  // Repeated khan (but not ។ល។)
  for (const m of text.matchAll(/\u17D4{2,}/gu)) {
    add({ start: m.index, end: m.index + m[0].length, severity: 'warning', confidence: 0.9, ruleId: 'punct.repeated-khan',
      title: 'ខណ្ឌសញ្ញាដដែលៗ', explanation: 'សញ្ញា «។» ត្រូវបានវាយជាប់គ្នាច្រើនដង។', suggestions: ['។'], autoFixSafe: true });
  }
  for (const m of text.matchAll(/([!?]){2,}/gu)) {
    add({ start: m.index, end: m.index + m[0].length, severity: 'suggestion', confidence: 0.7, ruleId: 'punct.repeated-mark',
      title: 'សញ្ញាដដែលៗ', explanation: 'សំណេរផ្លូវការប្រើសញ្ញាសួរ ឬឧទានតែមួយ។', suggestions: [m[1]], autoFixSafe: true });
  }
  // No space after ។ before the next Khmer word (excluding ។ល។)
  for (const m of text.matchAll(/\u17D4(?=[\u1780-\u17B3])/gu)) {
    if (text.slice(m.index - 2, m.index + 3).includes('\u17D4\u179B')) continue; // ។ល។ and ។ល
    add({ start: m.index, end: m.index + 1, severity: 'suggestion', confidence: 0.65, ruleId: 'punct.space-after-khan',
      title: 'ខ្វះដកឃ្លាក្រោយខណ្ឌសញ្ញា',
      explanation: 'បន្ទាប់ពី «។» ជាធម្មតាដកឃ្លាមួយ មុនចាប់ផ្ដើមល្បះថ្មី ដើម្បីឱ្យអានងាយ និងបំបែកបន្ទាត់ត្រឹមត្រូវ។', suggestions: ['។ '], autoFixSafe: true });
  }
  // ៗ problems
  for (const m of text.matchAll(/[ \t\u200B]+\u17D7/gu)) {
    add({ start: m.index, end: m.index + m[0].length, severity: 'warning', confidence: 0.85, ruleId: 'punct.space-before-lek-too',
      title: 'ដកឃ្លានៅមុខលេខទោ', explanation: 'លេខទោ «ៗ» ត្រូវនៅជាប់នឹងពាក្យដែលវាធ្វើឱ្យដដែល។', suggestions: ['ៗ'], autoFixSafe: true });
  }
  for (const m of text.matchAll(/(^|[\n\u17D4\u17D5?!\u00AB(])[ \t]*\u17D7/gu)) {
    const at = m.index + m[0].length - 1;
    add({ start: at, end: at + 1, severity: 'error', confidence: 0.85, ruleId: 'punct.lek-too-without-word',
      title: 'លេខទោគ្មានពាក្យនៅមុខ', explanation: 'លេខទោ «ៗ» ត្រូវតែនៅក្រោយពាក្យដែលត្រូវនិយាយដដែល។', suggestions: [] });
  }
  for (const m of text.matchAll(/\u17D7{2,}/gu)) {
    add({ start: m.index, end: m.index + m[0].length, severity: 'warning', confidence: 0.85, ruleId: 'punct.double-lek-too',
      title: 'លេខទោពីរដង', explanation: 'លេខទោ «ៗ» តែមួយគ្រប់គ្រាន់។', suggestions: ['ៗ'], autoFixSafe: true });
  }
  // Multiple spaces
  for (const m of text.matchAll(/(?<=\S)[ ]{2,}(?=\S)/gu)) {
    add({ start: m.index, end: m.index + m[0].length, severity: 'suggestion', confidence: 0.7, ruleId: 'punct.multiple-spaces',
      title: 'ដកឃ្លាច្រើនពេក', explanation: 'មានដកឃ្លាជាប់គ្នាច្រើន។ ប្រសិនបើមិនមែនសម្រាប់តម្រឹមទ្រង់ទ្រាយទេ ដកឃ្លាមួយគ្រប់គ្រាន់។', suggestions: [' '], autoFixSafe: true });
  }
  // Space before comma
  for (const m of text.matchAll(/[ \t]+,/gu)) {
    add({ start: m.index, end: m.index + m[0].length, severity: 'suggestion', confidence: 0.6, ruleId: 'punct.space-before-comma',
      title: 'ដកឃ្លានៅមុខក្បៀស', explanation: 'ក្បៀសជាធម្មតាភ្ជាប់នឹងពាក្យខាងមុខ។', suggestions: [','], autoFixSafe: true });
  }
  // Unbalanced « »
  const opens = [];
  for (const m of text.matchAll(/[\u00AB\u00BB]/gu)) {
    if (m[0] === '«') opens.push(m.index);
    else if (opens.length) opens.pop();
    else add({ start: m.index, end: m.index + 1, severity: 'warning', confidence: 0.7, ruleId: 'punct.unbalanced-quote',
      title: 'សញ្ញាសម្រង់មិនគ្រប់គូ', explanation: 'សញ្ញាបិទ «»» គ្មានសញ្ញាបើក ««» ត្រូវគ្នា។', suggestions: [] });
  }
  for (const at of opens) add({ start: at, end: at + 1, severity: 'warning', confidence: 0.7, ruleId: 'punct.unbalanced-quote',
    title: 'សញ្ញាសម្រង់មិនគ្រប់គូ', explanation: 'សញ្ញាបើក «« » គ្មានសញ្ញាបិទ «» » ត្រូវគ្នា។', suggestions: [] });

  // Sentence beginning with តើ but ending with ។ (rule carried over from the prototype)
  for (const s of sentences) {
    const first = s.words[0];
    if (first && first.key === 'តើ' && s.terminator === '។') {
      const end = s.tokens[s.tokens.length - 1];
      add({ start: end.start, end: end.end, severity: 'suggestion', confidence: 0.6, ruleId: 'punct.question-mark',
        title: 'ល្បះសំណួរ',
        explanation: 'ល្បះនេះចាប់ផ្ដើមដោយ «តើ» ដែលបង្ហាញថាជាសំណួរផ្ទាល់ ប៉ុន្តែបញ្ចប់ដោយ «។»។ ប្រសិនបើជាសំណួរ គួរប្រើ «?»។',
        suggestions: ['?'], source: 'textbook-unverified', autoFixSafe: false });
    }
  }

  // Paragraph ends without terminal punctuation (prose only, not headings or list items)
  {
    let off = 0;
    for (const line of text.split('\n')) {
      const trimmed = line.replace(/[\s\u200B]+$/u, '');
      const words = (trimmed.match(/[\u1780-\u17B3]+/gu) || []).length;
      const listLike = /^\s*([-\u2022*\u2013]|[0-9\u17E0-\u17E9]+[.)]|[\u1780-\u17A2][.)]|\u1798\u17B6\u178F\u17D2\u179A\u17B6|\u1787\u17C6\u1796\u17BC\u1780|\u1795\u17D2\u1793\u17C2\u1780|\u1780\u1790\u17B6\u1781\u178E\u17D2\u178C)/u.test(trimmed);
      if (trimmed.length >= 60 && words >= 4 && !listLike && /[\u1780-\u17D3\u17DD]$/u.test(trimmed)) {
        const end = off + trimmed.length;
        const lastCluster = trimmed.match(/[\u1780-\u17D3\u17DD]+$/u)[0];
        add({ start: end - lastCluster.length, end, severity: 'suggestion', confidence: 0.5, ruleId: 'punct.missing-final-khan',
          category: 'punctuation', title: 'ខ្វះខណ្ឌសញ្ញានៅចុងកថាខណ្ឌ',
          explanation: 'កថាខណ្ឌនេះបញ្ចប់ដោយគ្មាន «។»។ បើវាមិនមែនជាចំណងជើង ឬធាតុក្នុងបញ្ជី គួរបន្ថែម «។»។',
          suggestions: [lastCluster + '។'] });
      }
      off += line.length + 1;
    }
  }

  // Space-before-khan style: flag the minority style only when both occur
  const spaced = [...text.matchAll(/[\u1780-\u17DD] \u17D4/gu)], tight = [...text.matchAll(/[\u1780-\u17DD]\u17D4/gu)];
  if (spaced.length && tight.length) {
    const minority = spaced.length < tight.length ? spaced : null;
    if (minority) for (const m of minority) add({ start: m.index + 1, end: m.index + 3, severity: 'suggestion', confidence: 0.55,
      ruleId: 'punct.khan-spacing-consistency', category: 'terminology', title: 'ការដកឃ្លាមុខ «។» មិនស៊ីសង្វាក់',
      explanation: 'ឯកសារនេះភាគច្រើនសរសេរ «។» ជាប់នឹងពាក្យ ប៉ុន្តែកន្លែងនេះមានដកឃ្លានៅមុខ។ គួរប្រើរបៀបតែមួយ។', suggestions: ['។'], source: 'document', autoFixSafe: true });
  }
  return out;
}
