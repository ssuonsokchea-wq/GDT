// KhmerProof browser application.
import { CATEGORIES, SEVERITIES, CONFIDENCE_KM } from './engine/finding.js';
import { buildReportModel, reportHtml, reportCsv } from './engine/report.js';
import { readDocx, writeCorrectedDocx, writeTextDocx, writeReportDocx } from './engine/docx.js';
import { extractPdfText, visualOrderScore } from './engine/pdftext.js';
import { MODES } from './engine/analyzer.js';
import { toKhmerDigits } from './engine/chars.js';

const $ = id => document.getElementById(id);
const editor = $('editor'), backdrop = $('backdrop'), list = $('issueList');
const MAX_TEXT = 300000;
const LEXICON_URL = new URL('./data/lexicon.json', location.href).href;

const SAMPLE = `សួរស្តី! ខ្ងុំចង់អានពត៌មានអំពីប្រទេសកម្ពុជា។ ខ្ញុំសាលារៀនទៅ។
បច្ចប្បន្ននេះ ពួកយើងបានពិនិត្សឯកសារទាំងអស់ ហើយខ្ញុំនិងផ្ញើរបាយការណ៍ទៅក្រសួងនៅថ្ងៃស្អែក។ គាត់ក៏ទៅដែល។
សូមអនុញ្ញាតិអោយខ្ញុំធ្វើការសិក្សាលើបញ្ហានេះ.`;

const state = {
  mode: 'general', profile: 'standard',
  findings: [], aiFindings: [], decisions: [], rejected: new Set(), undo: [],
  originalText: '', documentName: null, docxImport: null, documentHash: null,
  filter: new Set(), minConf: 0, showUnverified: true, selected: null,
  ready: false, server: { pdf: false, ai: false, pdfText: false },
  userWords: [], termRules: [], ncklWords: [],
};

// ---------- persistence (settings only, never document text) ----------
const store = {
  get(k, d) { try { const v = localStorage.getItem('khmerproof.' + k); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('khmerproof.' + k, JSON.stringify(v)); } catch { /* private mode */ } },
};

// ---------- worker ----------
const worker = new Worker(new URL('./worker.js', location.href), { type: 'module' });
let reqId = 0;
const pending = new Map();
worker.onmessage = ({ data }) => {
  if (data.type === 'ready') {
    state.ready = true;
    $('engineStatus').textContent = `វចនានុក្រម ${toKhmerDigits(data.entries.toLocaleString('en'))} ពាក្យ`;
    check();
    return;
  }
  const p = pending.get(data.id);
  if (!p) { if (data.type === 'error') toast('កំហុស៖ ' + data.message); return; }
  pending.delete(data.id);
  data.type === 'error' ? p.reject(new Error(data.message)) : p.resolve(data);
};
worker.onerror = e => { $('engineStatus').textContent = 'មិនអាចផ្ទុកម៉ាស៊ីនពិនិត្យបានទេ'; console.error(e); };
function ask(msg) { return new Promise((resolve, reject) => { const id = ++reqId; pending.set(id, { resolve, reject }); worker.postMessage({ ...msg, id }); }); }

// ---------- analysis ----------
let timer = null, latest = 0;
function scheduleCheck(delay = 350) { clearTimeout(timer); timer = setTimeout(check, delay); }
async function check() {
  if (!state.ready) return;
  const text = editor.value;
  const id = ++latest;
  $('engineStatus').textContent = 'កំពុងពិនិត្យ…';
  try {
    const { result } = await ask({ type: 'analyze', text, options: { mode: state.mode, profile: state.profile, termRules: state.termRules, ignoreWords: [] } });
    if (id !== latest || text !== editor.value) return; // stale
    state.findings = result.findings;
    state.checkedText = text;
    state.settings = result.settings;
    state.stats = result.stats;
    // AI findings survive only while their text is unchanged
    state.aiFindings = state.aiFindings.filter(f => text.slice(f.start, f.end) === f.original);
    $('engineStatus').textContent = `ពិនិត្យរួច · ${toKhmerDigits(result.stats.ms)} ms`;
    render();
  } catch (e) {
    $('engineStatus').textContent = 'កំហុស៖ ' + e.message;
  }
}

const keyOf = f => `${f.ruleId}|${f.original}|${f.context}`;
function visibleFindings() {
  return [...state.findings, ...state.aiFindings]
    .filter(f => !state.rejected.has(keyOf(f)))
    .filter(f => state.showUnverified || f.category !== 'unverified')
    .filter(f => !state.onlyFixable || f.suggestions.length)
    .filter(f => f.confidence >= state.minConf || f.category === 'unverified')
    .sort((a, b) => a.start - b.start);
}
function openFindings() { return [...state.findings, ...state.aiFindings].filter(f => !state.rejected.has(keyOf(f))); }

// ---------- rendering ----------
function render() {
  renderBackdrop();
  renderFilters();
  renderList();
  renderStats();
}

function renderBackdrop() {
  const text = editor.value;
  // Sentence-level rewrites are listed but not drawn, so word-level marks stay visible.
  const all = visibleFindings().filter(f => f.scope !== 'sentence' && (!state.filter.size || state.filter.has(group(f.category))));
  const frag = document.createDocumentFragment();
  let pos = 0;
  for (const f of all) {
    if (f.start < pos || f.end <= f.start) continue;
    frag.append(text.slice(pos, f.start));
    const m = document.createElement('mark');
    m.className = `c-${f.category}${f.category === 'unverified' ? ' unverified' : ''}${state.selected === f.id ? ' sel' : ''}`;
    m.textContent = text.slice(f.start, f.end);
    frag.append(m);
    pos = f.end;
  }
  frag.append(text.slice(pos) + '\n');
  backdrop.replaceChildren(frag);
  syncScroll();
}
function syncScroll() { backdrop.scrollTop = editor.scrollTop; backdrop.scrollLeft = editor.scrollLeft; }

const GROUPS = {
  spelling: { km: 'អក្ខរាវិរុទ្ធ', cats: ['spelling'] },
  grammar: { km: 'វេយ្យាករណ៍ និងល្បះ', cats: ['grammar', 'structure', 'missing'] },
  style: { km: 'ពាក្យ និងរចនាប័ទ្ម', cats: ['wording', 'unnecessary', 'clarity', 'repetition'] },
  punctuation: { km: 'វណ្ណយុត្តិ', cats: ['punctuation'] },
  terminology: { km: 'ពាក្យបច្ចេកទេស', cats: ['terminology'] },
  unicode: { km: 'យូនីកូដ', cats: ['unicode'] },
  unverified: { km: 'មិនមានក្នុងវចនានុក្រម', cats: ['unverified'] },
};
const group = cat => Object.keys(GROUPS).find(g => GROUPS[g].cats.includes(cat)) || 'style';

function renderFilters() {
  const counts = {};
  for (const f of visibleFindings()) counts[group(f.category)] = (counts[group(f.category)] || 0) + 1;
  const box = $('categoryFilters');
  box.replaceChildren(...Object.entries(GROUPS).filter(([g]) => counts[g]).map(([g, info]) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `chip c-${info.cats[0]}`;
    b.setAttribute('aria-pressed', String(state.filter.has(g)));
    b.textContent = `${info.km} ${toKhmerDigits(counts[g])}`;
    b.onclick = () => { state.filter.has(g) ? state.filter.delete(g) : state.filter.add(g); render(); };
    return b;
  }));
}

function renderList() {
  const items = visibleFindings().filter(f => !state.filter.size || state.filter.has(group(f.category)));
  $('issueCount').textContent = toKhmerDigits(items.length);
  if (!items.length) {
    const li = document.createElement('li');
    li.className = 'empty';
    li.textContent = !editor.value.trim() ? 'សរសេរ ឬបើកឯកសារ ដើម្បីចាប់ផ្ដើមពិនិត្យ។'
      : 'រកមិនឃើញបញ្ហាដោយវិធានបច្ចុប្បន្នទេ។ នេះមិនមែនជាការធានាថាអត្ថបទគ្មានកំហុសទាំងស្រុងទេ។';
    list.replaceChildren(li);
    return;
  }
  list.replaceChildren(...items.map(card));
}

function el(tag, props = {}, ...children) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') e.className = v; else if (k.startsWith('on')) e[k] = v; else if (v !== undefined && v !== null) e.setAttribute(k, v);
  }
  e.append(...children.filter(c => c !== null && c !== undefined && c !== false));
  return e;
}

function card(f) {
  const pct = Math.round(f.confidence * 100);
  const show = s => s.replace(/​/g, '⟨ZWSP⟩') || '∅';
  const change = f.scope === 'sentence' && f.suggestions.length
    ? el('div', { class: 'rewrite', lang: 'km' }, el('span', { class: 'tag' }, 'មុន'), el('span', { class: 'before' }, f.original),
      el('span', { class: 'tag' }, 'ក្រោយ'), el('span', { class: 'after' }, f.suggestions[0]))
    : el('div', { class: 'change', lang: 'km' }, el('del', {}, show(f.original)), f.suggestions.length ? ` → ${show(f.suggestions[0])}` : null);
  const actions = el('div', { class: 'actions' });
  f.suggestions.slice(0, 4).forEach((s, i) => actions.append(el('button', {
    type: 'button', title: 'ទទួលយកការកែនេះ', 'aria-label': `ទទួលយក «${s}»`,
    onclick: ev => { ev.stopPropagation(); accept(f, s); },
  }, f.scope === 'sentence' ? '✓ ប្រើល្បះថ្មី' : i === 0 ? `✓ ${show(s)}` : show(s))));
  if (state.server.ai && ['clarity', 'unnecessary', 'wording', 'structure', 'repetition'].includes(f.category)) {
    actions.append(el('button', { type: 'button', class: 'ghost', onclick: ev => { ev.stopPropagation(); rephrase(...sentenceRange(f.start)); } }, '✦ សរសេរឡើងវិញ'));
  }
  if (!f.suggestions.length) {
    // Advice without an automatic replacement: let the writer jump to the passage and fix it.
    actions.append(el('button', { type: 'button', onclick: ev => { ev.stopPropagation(); select(f, true); toast('បានជ្រើសអត្ថបទ។ សូមកែដោយខ្លួនឯង រួចពិនិត្យម្ដងទៀត។'); } }, '✎ កែក្នុងអត្ថបទ'));
  }
  actions.append(el('button', { type: 'button', class: 'ghost', onclick: ev => { ev.stopPropagation(); reject(f); } }, '✕ បដិសេធ'));
  if (f.category === 'spelling' || f.category === 'unverified') {
    actions.append(el('button', { type: 'button', class: 'ghost', title: 'បន្ថែមពាក្យនេះទៅសទ្ទានុក្រមផ្ទាល់ខ្លួន', onclick: ev => { ev.stopPropagation(); addUserWord(f.original); } }, '+ សទ្ទានុក្រម'));
  }
  const src = el('details', { class: 'src' }, el('summary', {}, 'ប្រភពយោង'),
    el('div', {}, f.source.km), f.source.detail ? el('div', {}, f.source.detail) : null,
    el('div', { lang: 'en' }, f.source.en), f.source.url ? el('div', { lang: 'en' }, f.source.url) : null);
  const c = el('li', { class: `card c-${f.category}${state.selected === f.id ? ' sel' : ''}`, tabindex: '0', 'data-id': f.id,
    'aria-label': `${CATEGORIES[f.category].km}: ${f.original}` },
  el('div', { class: 'card-top' },
    el('span', { class: 'cat' }, `${CATEGORIES[f.category].km} · ${SEVERITIES[f.severity].km}`),
    el('span', { class: 'conf', title: 'កម្រិតទំនុកចិត្តរបស់វិធាន (មិនមែនប្រូបាប៊ីលីតេដែលបានវាស់)' },
      `ទំនុកចិត្ត ${CONFIDENCE_KM[f.confidenceLevel]} ${toKhmerDigits(pct)}%`,
      el('span', { class: 'conf-bar' }, el('span', { style: null })))),
  el('h3', {}, f.title), f.suggestions.length ? change : el('div', { class: 'change', lang: 'km' }, show(f.original)),
  !f.suggestions.length ? el('p', { class: 'advice' }, 'ការណែនាំ៖ មិនមានពាក្យជំនួសស្វ័យប្រវត្តិទេ។ ចុច «✎ កែក្នុងអត្ថបទ» ដើម្បីកែដោយខ្លួនឯង។') : null,
  el('p', {}, f.explanation),
  f.legalNote ? el('p', { class: 'legal-note' }, f.legalNote) : null,
  el('p', { class: 'src' }, `ទីតាំង៖ កថាខណ្ឌ ${toKhmerDigits(f.location?.paragraph ?? '')} · បន្ទាត់ ${toKhmerDigits(f.location?.line ?? '')}`),
  src, actions);
  c.querySelector('.conf-bar > span').style.width = pct + '%';
  c.onclick = () => select(f, true);
  c.onkeydown = ev => { if (ev.key === 'Enter' && ev.target === c) select(f, true); };
  return c;
}

function renderStats() {
  const s = state.stats;
  $('docStats').textContent = s ? `${toKhmerDigits(s.words)} ពាក្យ · ${toKhmerDigits(s.sentences)} ល្បះ` : '';
  $('undoBtn').disabled = !state.undo.length;
  $('decisionCount').textContent = toKhmerDigits(state.decisions.length);
  $('decisionList').replaceChildren(...state.decisions.slice().reverse().map(d =>
    el('li', {}, `${d.status === 'accepted' ? '✓' : '✕'} «${d.finding.original}»${d.status === 'accepted' ? ` → «${d.replacement}»` : ''} (${CATEGORIES[d.finding.category].km})`)));
}

function select(f, focusText) {
  state.selected = f.id;
  render();
  if (focusText) {
    editor.focus();
    editor.setSelectionRange(f.start, f.end);
    // scroll the textarea so the selection is visible
    const before = editor.value.slice(0, f.start);
    const lines = before.split('\n').length;
    const lineHeight = parseFloat(getComputedStyle(editor).lineHeight) || 36;
    editor.scrollTop = Math.max(0, (lines - 3) * lineHeight);
    syncScroll();
  }
  list.querySelector(`[data-id="${f.id}"]`)?.scrollIntoView({ block: 'nearest' });
}

// ---------- decisions ----------
function pushUndo() { state.undo.push({ text: editor.value, decisions: state.decisions.length, rejected: [...state.rejected] }); if (state.undo.length > 100) state.undo.shift(); }

function accept(f, suggestion) {
  if (editor.value.slice(f.start, f.end) !== f.original) { toast('អត្ថបទបានផ្លាស់ប្ដូរ។ កំពុងពិនិត្យម្ដងទៀត…'); check(); return; }
  if (f.humanReview && !confirm(`${f.legalNote || 'ការកែនេះត្រូវការការពិនិត្យដោយមនុស្ស។'}\n\nទទួលយក «${f.original}» → «${suggestion}» ?`)) return;
  pushUndo();
  editor.setRangeText(suggestion, f.start, f.end, 'preserve');
  state.decisions.push({ finding: f, status: 'accepted', replacement: suggestion, at: new Date().toISOString() });
  state.selected = null;
  check();
  toast('បានកែ។ អាចចុច «ត្រឡប់» ដើម្បីលុបចោល។');
}

function reject(f) {
  pushUndo();
  state.rejected.add(keyOf(f));
  state.decisions.push({ finding: f, status: 'rejected', replacement: null, at: new Date().toISOString() });
  render();
}

function undo() {
  const u = state.undo.pop();
  if (!u) return;
  editor.value = u.text;
  state.decisions.length = u.decisions;
  state.rejected = new Set(u.rejected);
  check();
}

// ---------- documents ----------
async function sha256(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}

async function setDocument(text, name, docxImport = null) {
  if (text.length > MAX_TEXT) { text = text.slice(0, MAX_TEXT); notice(`ឯកសារវែងពេក។ KhmerProof ពិនិត្យតែ ${toKhmerDigits(MAX_TEXT.toLocaleString('en'))} តួអក្សរដំបូង។`); }
  editor.value = text;
  state.originalText = text;
  state.documentName = name;
  state.docxImport = docxImport;
  state.decisions = []; state.rejected = new Set(); state.undo = []; state.aiFindings = []; state.selected = null;
  state.documentHash = text ? await sha256(text) : null;
  $('docName').textContent = name || 'អត្ថបទថ្មី';
  check();
}

function notice(msg) { $('notices').append(el('div', { class: 'notice' }, msg)); }
function clearNotices() { $('notices').replaceChildren(); }

async function openFile(file) {
  if (!file) return;
  clearNotices();
  const name = file.name;
  try {
    if (file.size > 25 * 1024 * 1024) throw new Error('ឯកសារធំពេក (អតិបរមា 25 MB)');
    if (/\.txt$/i.test(name) || file.type === 'text/plain') {
      const buf = new Uint8Array(await file.arrayBuffer());
      let text = new TextDecoder('utf-8', { fatal: false }).decode(buf).replace(/^﻿/, '').replace(/\r\n?/g, '\n');
      if (text.includes('�')) notice('ឯកសារ TXT មិនមែនជា UTF-8 ទាំងស្រុងទេ។ តួអក្សរខ្លះអាចខូច។ សូមរក្សាទុកឯកសារជា UTF-8។');
      await setDocument(text, name);
    } else if (/\.docx$/i.test(name)) {
      const imp = readDocx(new Uint8Array(await file.arrayBuffer()));
      imp.warnings.forEach(notice);
      notice('ពេលទាញយក Word ដែលបានកែ KhmerProof រក្សាទ្រង់ទ្រាយដើម (ពុម្ពអក្សរ តារាង) តាមដែលអាចធ្វើបាន។ កម្មវិធីកែនេះបង្ហាញតែអត្ថបទ។');
      await setDocument(imp.text, name, imp);
    } else if (/\.pdf$/i.test(name) || file.type === 'application/pdf') {
      await openPdf(file);
    } else {
      throw new Error('សូមប្រើឯកសារ .txt, .docx ឬ .pdf');
    }
    toast('បានបើកឯកសារ');
  } catch (e) {
    toast('មិនអាចបើកឯកសារ៖ ' + e.message);
  }
}

async function openPdf(file) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (state.server.pdfText && await consent('ដើម្បីដកអត្ថបទខ្មែរពី PDF ឱ្យបានត្រឹមត្រូវ ឯកសារនឹងត្រូវផ្ញើទៅម៉ាស៊ីនមេ KhmerProof ដែលអ្នកកំពុងប្រើ។ ម៉ាស៊ីនមេដកអត្ថបទក្នុងអង្គចងចាំ ហើយលុបឯកសារភ្លាមៗ មិនរក្សាទុកទេ។ ប្រសិនបើមិនយល់ព្រម KhmerProof នឹងដកអត្ថបទក្នុង browser ដែលអាចមិនសូវត្រឹមត្រូវ។')) {
    const res = await fetch('./api/extract/pdf', { method: 'POST', headers: { 'Content-Type': 'application/pdf' }, body: bytes });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || res.status);
    data.warnings?.forEach(notice);
    await setDocument(data.text, file.name);
    return;
  }
  const pdfjs = await import('./vendor/pdfjs/pdf.min.mjs');
  pdfjs.GlobalWorkerOptions.workerSrc = new URL('./vendor/pdfjs/pdf.worker.min.mjs', location.href).href;
  const r = await extractPdfText(pdfjs, bytes);
  r.warnings.forEach(notice);
  // Detect text damaged by visual-order glyph storage (common in Khmer PDFs)
  if (r.text && visualOrderScore(r.text) > 0.05) notice('⚠ អត្ថបទដែលដកចេញពី PDF នេះប្រហែលខូច (ស្រៈ ឬជើងអក្សរខុសលំដាប់ ឬបាត់)។ លទ្ធផលពិនិត្យអាចមានកំហុសច្រើន។ សូមប្រើឯកសារ Word ដើម ឬដំណើរការ KhmerProof ជាមួយម៉ាស៊ីនមេ (មាន pdftotext)។');
  await setDocument(r.text, file.name);
}

function consent(text) {
  return new Promise(resolve => {
    const d = $('consentDialog');
    $('consentText').textContent = text;
    $('consentCheck').checked = false;
    $('consentOk').disabled = true;
    d.onclose = () => resolve(d.returnValue === 'ok');
    d.showModal();
  });
}

// ---------- exports ----------
function download(data, name, type) {
  const url = URL.createObjectURL(data instanceof Blob ? data : new Blob([data], { type }));
  const a = el('a', { href: url, download: name });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}
const baseName = () => (state.documentName || 'KhmerProof').replace(/\.[^.]+$/, '').replace(/[\\/:*?"<>|]/g, '_');

function model() {
  return buildReportModel({
    title: state.documentName || 'KhmerProof', documentName: state.documentName, text: editor.value,
    open: openFindings(), decisions: state.decisions,
    settings: state.settings || { mode: state.mode, profile: state.profile }, documentHash: state.documentHash,
    includeFullText: $('includeFullText').checked,
  });
}

async function exportAs(kind) {
  $('exportMenu').open = false;
  const date = new Date().toISOString().slice(0, 10);
  const stem = `${baseName()}_KhmerProof_${date}`;
  try {
    if (kind === 'html') download(reportHtml(model()), `${stem}.html`, 'text/html;charset=utf-8');
    else if (kind === 'csv') download(reportCsv(model()), `${stem}.csv`, 'text/csv;charset=utf-8');
    else if (kind === 'docx') download(writeReportDocx(model()), `${stem}.docx`, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    else if (kind === 'txt') download(editor.value, `${baseName()}_corrected.txt`, 'text/plain;charset=utf-8');
    else if (kind === 'corrected-docx') {
      let bytes = null;
      if (state.docxImport) {
        const r = writeCorrectedDocx(state.docxImport, editor.value);
        if (r.preserved) bytes = r.bytes; else toast(`មិនអាចរក្សាទ្រង់ទ្រាយដើម៖ ${r.reason}។ ទាញយកជាអត្ថបទធម្មតាវិញ។`);
      }
      download(bytes || writeTextDocx(editor.value), `${baseName()}_corrected.docx`, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    } else if (kind === 'pdf') await exportPdf(stem);
  } catch (e) {
    toast('មិនអាចបង្កើតឯកសារ៖ ' + e.message);
  }
}

async function exportPdf(stem) {
  const m = model();
  if (state.server.pdf && await consent('ដើម្បីបង្កើត PDF ដែលមានពុម្ពអក្សរខ្មែរត្រឹមត្រូវ របាយការណ៍នឹងត្រូវផ្ញើទៅម៉ាស៊ីនមេ KhmerProof ដែលអ្នកកំពុងប្រើ។ ម៉ាស៊ីនមេបង្កើត PDF ក្នុងអង្គចងចាំ ហើយមិនរក្សាទុកទេ។ ប្រសិនបើមិនយល់ព្រម KhmerProof នឹងបើកផ្ទាំងបោះពុម្ព ដើម្បីរក្សាទុកជា PDF ក្នុង browser។')) {
    toast('កំពុងបង្កើត PDF…');
    const res = await fetch('./api/report/pdf', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model: m }) });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || res.status);
    download(await res.blob(), `${stem}.pdf`, 'application/pdf');
    return;
  }
  // Browser fallback: print the HTML report and choose "Save as PDF".
  const w = window.open(URL.createObjectURL(new Blob([reportHtml(m, { forPrint: true })], { type: 'text/html;charset=utf-8' })), '_blank');
  if (!w) { toast('សូមអនុញ្ញាតឱ្យបើកផ្ទាំងថ្មី រួចសាកម្ដងទៀត។'); return; }
  toast('ក្នុងផ្ទាំងថ្មី សូមជ្រើស «Print» → «Save as PDF»។');
  w.addEventListener('load', () => setTimeout(() => w.print(), 400), { once: true });
}

// ---------- AI ----------
async function aiReview() {
  const text = editor.value;
  if (!text.trim()) return;
  if (text.length > 6000) { toast('ការពិនិត្យ AI ទទួលបានអតិបរមា ៦០០០ តួអក្សរ។ សូមជ្រើសផ្នែកខ្លីជាងនេះ។'); return; }
  const legal = state.mode === 'legal' ? ' របៀបច្បាប់៖ សំណើពី AI ទាំងអស់ត្រូវការការពិនិត្យដោយអ្នកជំនាញ។' : '';
  if (!await consent(`អត្ថបទនេះនឹងត្រូវផ្ញើទៅម៉ាស៊ីនមេ KhmerProof និងទៅ Anthropic (Claude) ដើម្បីវិភាគបរិបទ។ កុំផ្ញើឯកសារសម្ងាត់ ដែលអ្នកគ្មានការអនុញ្ញាត។ សំណើពី AI មានទំនុកចិត្តទាប ហើយត្រូវផ្ទៀងផ្ទាត់។${legal}`)) return;
  $('aiBtn').disabled = true;
  toast('កំពុងពិនិត្យបរិបទ…');
  try {
    const res = await fetch('./api/ai-review', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text, mode: state.mode }) });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || res.status);
    if (editor.value !== text) { toast('អត្ថបទបានផ្លាស់ប្ដូរ ពេលកំពុងពិនិត្យ។ សូមសាកម្ដងទៀត។'); return; }
    state.aiFindings = data.findings.map((f, i) => ({ ...f, id: `AI${i + 1}` }));
    toast(data.note || `AI បានផ្ដល់សំណើ ${toKhmerDigits(state.aiFindings.length)}`);
    render();
  } catch (e) {
    toast('ការពិនិត្យ AI បរាជ័យ៖ ' + e.message);
  } finally {
    $('aiBtn').disabled = false;
  }
}

// ---------- AI rephrasing ----------
/** The sentence around an offset: from the previous to the next ។ ៕ ? ! or line break. */
function sentenceRange(at) {
  const t = editor.value;
  let s = at, e = at;
  while (s > 0 && !/[\u17D4\u17D5?!\n]/u.test(t[s - 1])) s--;
  while (e < t.length && !/[\u17D4\u17D5?!\n]/u.test(t[e])) e++;
  if (e < t.length && t[e] !== '\n') e++;
  while (s < e && /\s/u.test(t[s])) s++;
  return [s, e];
}

async function rephrase(start, end) {
  if (start === undefined) {
    [start, end] = editor.selectionStart !== editor.selectionEnd ? [editor.selectionStart, editor.selectionEnd] : sentenceRange(editor.selectionStart);
  }
  const passage = editor.value.slice(start, end);
  if (!passage.trim()) { toast('ជ្រើសអត្ថបទ ឬដាក់ទស្សន៍ទ្រនិចក្នុងល្បះ ដែលចង់សរសេរឡើងវិញ។'); return; }
  if (passage.length > 1500) { toast('សូមជ្រើសអត្ថបទខ្លីជាង ១៥០០ តួអក្សរ។'); return; }
  if (!state.aiConsent) {
    const legal = state.mode === 'legal' ? ' របៀបច្បាប់៖ KhmerProof នឹងបោះបង់សំណើណាដែលប្ដូរពាក្យកំណត់ន័យច្បាប់។' : '';
    if (!await consent(`ល្បះដែលអ្នកជ្រើសនឹងត្រូវផ្ញើទៅម៉ាស៊ីនមេ KhmerProof និងទៅ Anthropic (Claude) ដើម្បីសរសេរឡើងវិញ។ កុំផ្ញើឯកសារសម្ងាត់ ដែលអ្នកគ្មានការអនុញ្ញាត។${legal}`)) return;
    state.aiConsent = true;
  }
  const d = $('rephraseDialog'), box = $('rephraseOptions');
  $('rephraseOriginal').textContent = passage;
  box.replaceChildren(el('p', { class: 'hint' }, 'កំពុងសរសេរឡើងវិញ…'));
  d.showModal();
  try {
    const res = await fetch('./api/rephrase', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: passage, mode: state.mode }) });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || res.status);
    if (!data.alternatives.length) { box.replaceChildren(el('p', {}, data.note || 'រកមិនឃើញសំណើដែលឆ្លងការពិនិត្យរបស់ KhmerProof ទេ។')); return; }
    box.replaceChildren(...data.alternatives.map(a => el('div', { class: 'rephrase-option' },
      el('span', { class: 'label' }, a.styleKm || 'សំណើ'), el('div', { class: 'text', lang: 'km' }, a.text),
      el('p', {}, a.explanation), a.meaningMarkersChanged ? el('p', { class: 'legal-note' }, 'ប្រយ័ត្ន៖ សំណើនេះប្ដូរពាក្យដូចជា «មិន» «ត្រូវ» «អាច» «និង/ឬ» ដែលអាចប្ដូរន័យ។') : null,
      el('div', { class: 'actions' }, el('button', { type: 'button', onclick: () => useRephrase(start, end, passage, a, d) }, '✓ ប្រើ')))));
  } catch (e) {
    box.replaceChildren(el('p', {}, 'មិនអាចសរសេរឡើងវិញបាន៖ ' + e.message));
  }
}

function useRephrase(start, end, passage, alt, dialog) {
  if (editor.value.slice(start, end) !== passage) { toast('អត្ថបទបានផ្លាស់ប្ដូរ។ សូមសាកម្ដងទៀត។'); dialog.close(); return; }
  pushUndo();
  editor.setRangeText(alt.text, start, end, 'preserve');
  const before = editor.value.slice(0, start);
  state.decisions.push({ status: 'accepted', replacement: alt.text, at: new Date().toISOString(), finding: {
    id: 'RW', start, end: start + passage.length, original: passage, context: passage, contextOffset: 0, category: 'clarity', severity: 'suggestion',
    confidence: 0.5, confidenceLevel: 'low', ruleId: 'ai.rephrase', title: 'សរសេរឡើងវិញដោយ AI', explanation: alt.explanation, suggestions: [alt.text],
    source: { id: 'ai', km: 'ការសរសេរឡើងវិញដោយម៉ូដែល AI (ពិនិត្យដោយអ្នកប្រើ)', en: 'AI rephrasing, accepted by the user' },
    location: { line: before.split('\n').length, column: start - before.lastIndexOf('\n'), paragraph: before.split(/\n\s*\n/).length },
  } });
  dialog.close();
  check();
  toast('បានប្ដូរ។ អាចចុច «ត្រឡប់» ដើម្បីលុបចោល។');
}

// ---------- settings ----------
function parseTermRules(s) {
  return s.split('\n').map(l => l.split('=')).filter(p => p.length === 2 && p[0].trim())
    .map(([pref, vars]) => ({ preferred: pref.trim(), variants: vars.split(/[,，、]/).map(v => v.trim()).filter(Boolean) }));
}
function loadSettings() {
  state.mode = store.get('mode', 'general');
  state.profile = store.get('profile', 'standard');
  state.userWords = store.get('userWords', []);
  state.ncklWords = store.get('ncklWords', []);
  state.termRules = parseTermRules(store.get('termRules', ''));
  $('mode').value = state.mode;
  $('profile').value = state.profile;
}
function addUserWord(word) {
  if (!state.userWords.includes(word)) state.userWords.push(word);
  store.set('userWords', state.userWords);
  state.ready = false;
  $('engineStatus').textContent = 'កំពុងធ្វើបច្ចុប្បន្នភាពសទ្ទានុក្រម…';
  worker.postMessage({ type: 'words', lexiconUrl: LEXICON_URL, userWords: state.userWords, ncklWords: state.ncklWords });
  toast(`បានបន្ថែម «${word}» ទៅសទ្ទានុក្រមរបស់អ្នក`);
}
function openSettings() {
  $('userWords').value = state.userWords.join('\n');
  $('termRules').value = store.get('termRules', '');
  $('ncklStatus').textContent = state.ncklWords.length ? `បាននាំចូល ${toKhmerDigits(state.ncklWords.length)} ពាក្យ` : '';
  $('settingsDialog').showModal();
}
async function importNckl(file) {
  const text = await file.text();
  const words = text.replace(/^﻿/, '').split(/\r?\n/).map(l => l.split(/[\t,]/)[0].replace(/^"|"$/g, '').trim())
    .filter(w => /^[ក-៝​ ]+$/u.test(w));
  state.ncklWords = [...new Set(words)];
  $('ncklStatus').textContent = `រកឃើញ ${toKhmerDigits(state.ncklWords.length)} ពាក្យ។ ចុច «រក្សាទុក»។`;
}

// ---------- toast ----------
let toastTimer = null;
function toast(msg) { const t = $('toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 4000); }

// ---------- wiring ----------
function init() {
  loadSettings();
  worker.postMessage({ type: 'init', lexiconUrl: LEXICON_URL, userWords: state.userWords, ncklWords: state.ncklWords });
  // While typing, offsets of old findings no longer match: show plain text until the re-check.
  editor.addEventListener('input', () => { state.selected = null; backdrop.replaceChildren(editor.value + '\n'); syncScroll(); scheduleCheck(); });
  editor.addEventListener('scroll', syncScroll);
  new ResizeObserver(() => { backdrop.style.height = editor.offsetHeight + 'px'; syncScroll(); }).observe(editor);
  const caret = () => {
    const p = editor.selectionStart;
    if (editor.selectionEnd !== p) return;
    const f = visibleFindings().find(x => x.start <= p && x.end >= p && x.end > x.start);
    if (f && state.selected !== f.id) select(f, false);
  };
  editor.addEventListener('click', caret);
  editor.addEventListener('keyup', e => { if (e.key.startsWith('Arrow')) caret(); });
  $('mode').onchange = e => { state.mode = e.target.value; store.set('mode', state.mode); state.aiFindings = []; check(); toast(`របៀបសំណេរ៖ ${MODES[state.mode].km}`); };
  $('profile').onchange = e => { state.profile = e.target.value; store.set('profile', state.profile); check(); };
  $('uploadBtn').onclick = () => $('fileInput').click();
  $('fileInput').onchange = e => { openFile(e.target.files[0]); e.target.value = ''; };
  $('sampleBtn').onclick = () => { clearNotices(); setDocument(SAMPLE, 'ឧទាហរណ៍'); };
  $('clearBtn').onclick = () => { clearNotices(); setDocument('', null); };
  $('undoBtn').onclick = undo;
  $('aiBtn').onclick = aiReview;
  $('rephraseBtn').onclick = () => rephrase();
  // keep the selection: pressing the button must not move the caret first
  $('rephraseBtn').addEventListener('mousedown', e => e.preventDefault());
  document.querySelectorAll('[data-export]').forEach(b => { b.onclick = () => exportAs(b.dataset.export); });
  $('confFilter').onchange = e => { state.minConf = Number(e.target.value); render(); };
  $('showUnverified').onchange = e => { state.showUnverified = e.target.checked; render(); };
  $('onlyFixable').onchange = e => { state.onlyFixable = e.target.checked; store.set('onlyFixable', e.target.checked); render(); };
  state.onlyFixable = $('onlyFixable').checked = store.get('onlyFixable', false);
  $('settingsBtn').onclick = openSettings;
  $('ncklFile').onchange = e => { if (e.target.files[0]) importNckl(e.target.files[0]); };
  $('consentCheck').onchange = e => { $('consentOk').disabled = !e.target.checked; };
  $('settingsDialog').addEventListener('close', () => {
    if ($('settingsDialog').returnValue !== 'save') return;
    state.userWords = [...new Set($('userWords').value.split('\n').map(w => w.trim()).filter(Boolean))];
    store.set('userWords', state.userWords);
    store.set('termRules', $('termRules').value);
    store.set('ncklWords', state.ncklWords);
    state.termRules = parseTermRules($('termRules').value);
    state.ready = false;
    worker.postMessage({ type: 'words', lexiconUrl: LEXICON_URL, userWords: state.userWords, ncklWords: state.ncklWords });
    toast('បានរក្សាទុក');
  });
  document.addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'z' && document.activeElement !== editor && state.undo.length) { e.preventDefault(); undo(); }
  });
  // Optional server features
  fetch('./api/status').then(r => r.ok ? r.json() : null).then(s => {
    if (!s) return;
    state.server = { pdf: !!s.pdf, ai: !!s.ai, pdfText: !!s.pdfText };
    $('aiBtn').hidden = !s.ai;
    $('rephraseBtn').hidden = !s.ai;
    render();
  }).catch(() => {});
  render();
}
init();

// exposed for automated browser tests
window.__khmerproof = { state, check, accept, reject, model };
