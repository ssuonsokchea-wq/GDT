// Report model and HTML / CSV renderers, shared by the browser, the server and the CLI.
//
// A report lists every finding with: number, location, original passage, category,
// severity, explanation, suggested correction, confidence, source reference and the
// reviewer's decision. Text is always escaped; reports never contain scripts.

import { CATEGORIES, SEVERITIES, CONFIDENCE_KM } from './finding.js';
import { MODES, PROFILES, ENGINE_VERSION } from './analyzer.js';
import { toKhmerDigits } from './chars.js';

export const STATUS_KM = { open: 'មិនទាន់សម្រេច', accepted: 'បានទទួលយក', rejected: 'បានបដិសេធ' };
export const STATUS_EN = { open: 'Open', accepted: 'Accepted', rejected: 'Rejected' };

export function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

/**
 * Build the report model.
 * @param {object} p
 * @param {string} p.title
 * @param {string} p.text            the text as currently reviewed
 * @param {Array}  p.open            open findings on the current text
 * @param {Array}  p.decisions       [{finding, status:'accepted'|'rejected', replacement, at}]
 * @param {object} p.settings        {mode, profile, lexiconEntries, lexiconBuilt}
 * @param {string} [p.documentHash]  SHA-256 of the original text
 * @param {boolean}[p.includeFullText]
 */
export function buildReportModel(p) {
  const rows = [
    ...p.decisions.map(d => ({ ...d.finding, status: d.status, chosen: d.replacement ?? null, decidedAt: d.at })),
    ...p.open.map(f => ({ ...f, status: 'open', chosen: null })),
  ];
  rows.forEach((r, i) => { r.no = i + 1; });
  const byCategory = {};
  for (const r of rows) byCategory[r.category] = (byCategory[r.category] || 0) + 1;
  const bySeverity = {};
  for (const r of rows) bySeverity[r.severity] = (bySeverity[r.severity] || 0) + 1;
  return {
    title: p.title || 'KhmerProof',
    generatedAt: p.generatedAt || new Date().toISOString(),
    documentHash: p.documentHash || null,
    documentName: p.documentName || null,
    settings: { engineVersion: ENGINE_VERSION, ...p.settings },
    totals: { all: rows.length, open: p.open.length, accepted: p.decisions.filter(d => d.status === 'accepted').length, rejected: p.decisions.filter(d => d.status === 'rejected').length, byCategory, bySeverity },
    rows,
    fullText: p.includeFullText ? p.text : null,
  };
}

function rowFields(r) {
  const loc = r.location ? `កថាខណ្ឌ ${toKhmerDigits(r.location.paragraph)} · បន្ទាត់ ${toKhmerDigits(r.location.line)} · ជួរ ${toKhmerDigits(r.location.column)}` : '';
  const locEn = r.location ? `para ${r.location.paragraph}, line ${r.location.line}, col ${r.location.column}` : '';
  const suggestion = r.status === 'accepted' && r.chosen !== null ? r.chosen : (r.suggestions || []).join(' / ');
  const source = [r.source?.km, r.source?.detail].filter(Boolean).join(' — ');
  return { loc, locEn, suggestion, source };
}

export const CSV_HEADERS = ['No', 'Status', 'Paragraph', 'Line', 'Column', 'Start (UTF-16, 0-based)', 'End', 'Original passage', 'Flagged text', 'Category', 'Category (Khmer)', 'Severity', 'Explanation (Khmer)', 'Suggested correction', 'Confidence', 'Confidence level', 'Source', 'Source (English)', 'Source URL', 'Rule ID', 'Needs human review'];

/** CSV, UTF-8 with BOM so that Excel opens Khmer correctly. */
export function reportCsv(model) {
  const cell = v => `"${String(v ?? '').replace(/"/g, '""').replace(/\r?\n/g, ' ')}"`;
  const lines = [CSV_HEADERS.map(cell).join(',')];
  for (const r of model.rows) {
    const { suggestion, source } = rowFields(r);
    lines.push([r.no, STATUS_EN[r.status], r.location?.paragraph, r.location?.line, r.location?.column, r.start, r.end, r.context, r.original,
      CATEGORIES[r.category]?.en, CATEGORIES[r.category]?.km, SEVERITIES[r.severity]?.en, r.explanation + (r.legalNote ? ' ' + r.legalNote : ''),
      suggestion, Math.round(r.confidence * 100) + '%', r.confidenceLevel, source, r.source?.en, r.source?.url, r.ruleId, r.humanReview ? 'yes' : 'no'].map(cell).join(','));
  }
  return '﻿' + lines.join('\r\n') + '\r\n';
}

function passageHtml(r) {
  const ctx = r.context || r.original;
  const at = r.contextOffset ?? ctx.indexOf(r.original);
  if (at < 0 || ctx.slice(at, at + r.original.length) !== r.original) return escapeHtml(ctx);
  return escapeHtml(ctx.slice(0, at)) + '<mark>' + escapeHtml(r.original || '∅') + '</mark>' + escapeHtml(ctx.slice(at + r.original.length));
}

/**
 * Self-contained HTML report. `fontCss` may embed @font-face rules (used by the PDF
 * renderer so that the PDF carries a Khmer font).
 */
export function reportHtml(model, { fontCss = '', forPrint = false } = {}) {
  const s = model.settings;
  const date = new Date(model.generatedAt);
  const dateStr = `${toKhmerDigits(date.getUTCDate())}/${toKhmerDigits(date.getUTCMonth() + 1)}/${toKhmerDigits(date.getUTCFullYear())} ${date.toISOString().slice(11, 16)} UTC`;
  const catRows = Object.entries(model.totals.byCategory).sort((a, b) => b[1] - a[1])
    .map(([c, n]) => `<tr><td>${escapeHtml(CATEGORIES[c]?.km)}</td><td>${escapeHtml(CATEGORIES[c]?.en)}</td><td class="n">${toKhmerDigits(n)}</td></tr>`).join('');
  const rows = model.rows.map(r => {
    const { loc, locEn, suggestion, source } = rowFields(r);
    return `<tr class="st-${r.status}">
<td class="n">${toKhmerDigits(r.no)}</td>
<td><div>${escapeHtml(loc)}</div><div class="en">${escapeHtml(locEn)}</div></td>
<td class="passage">${passageHtml(r)}</td>
<td><b>${escapeHtml(CATEGORIES[r.category]?.km)}</b><div class="en">${escapeHtml(CATEGORIES[r.category]?.en)} · ${escapeHtml(SEVERITIES[r.severity]?.km)}</div></td>
<td>${escapeHtml(r.explanation)}${r.legalNote ? `<div class="legal">${escapeHtml(r.legalNote)}</div>` : ''}</td>
<td class="sug">${suggestion ? escapeHtml(suggestion) : '<span class="muted">—</span>'}</td>
<td class="n">${toKhmerDigits(Math.round(r.confidence * 100))}%<div class="en">${escapeHtml(CONFIDENCE_KM[r.confidenceLevel])}</div></td>
<td class="src">${escapeHtml(source)}${r.source?.url ? `<div class="en">${escapeHtml(r.source.url)}</div>` : ''}</td>
<td>${escapeHtml(STATUS_KM[r.status])}</td>
</tr>`;
  }).join('\n');
  return `<!doctype html>
<html lang="km"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(model.title)} — របាយការណ៍ពិនិត្យអត្ថបទ</title>
<style>
${fontCss}
:root{--ink:#1b1f24;--muted:#5b6470;--line:#d9dee5;--accent:#0b5cad;--mark:#ffe08a;--bg:#fff}
@media (prefers-color-scheme: dark){:root:not([data-theme="light"]){--ink:#e7eaee;--muted:#a3acb8;--line:#3a414b;--accent:#6fb1ff;--mark:#7a5b00;--bg:#14171b}}
*{box-sizing:border-box}
body{margin:0;padding:24px 16px;background:var(--bg);color:var(--ink);font-family:"Noto Sans Khmer","Khmer OS Siemreap","Khmer UI","Leelawadee UI",sans-serif;line-height:1.75;font-size:14px}
main{max-width:1200px;margin:0 auto}
h1{font-size:22px;margin:0 0 4px}h2{font-size:17px;margin:28px 0 8px;border-bottom:2px solid var(--accent);padding-bottom:4px}
.en{color:var(--muted);font-size:11.5px;line-height:1.4}
.muted{color:var(--muted)}
.meta{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:4px 24px;margin:12px 0}
.meta div{border-bottom:1px dotted var(--line);padding:2px 0}
table{border-collapse:collapse;width:100%}
th,td{border:1px solid var(--line);padding:6px 8px;vertical-align:top;text-align:left}
th{background:color-mix(in srgb,var(--accent) 12%,transparent);font-weight:600}
td.n{text-align:right;white-space:nowrap}
mark{background:var(--mark);color:inherit;padding:0 1px;border-radius:2px}
.passage{min-width:180px}.sug{font-weight:600}.src{font-size:12px;max-width:220px}
.legal{margin-top:4px;font-size:12px;color:#8a3b00}
.st-accepted td{background:color-mix(in srgb,#2e8b57 7%,transparent)}
.st-rejected td{opacity:.75}
.notice{border-left:4px solid var(--accent);padding:8px 12px;background:color-mix(in srgb,var(--accent) 6%,transparent);margin:12px 0}
.full{white-space:pre-wrap;border:1px solid var(--line);padding:12px}
.table-wrap{overflow-x:auto}
@media print{body{padding:0;font-size:11px}.table-wrap{overflow:visible}tr{break-inside:avoid}h2{break-after:avoid}thead{display:table-header-group}}
@page{size:A4 landscape;margin:12mm}
</style></head>
<body><main>
<h1>របាយការណ៍ពិនិត្យអក្ខរាវិរុទ្ធ និងវេយ្យាករណ៍ខ្មែរ</h1>
<div class="en">KhmerProof flagged-issues report</div>
<div class="meta">
<div>ឯកសារ៖ ${escapeHtml(model.documentName || model.title)}</div>
<div>កាលបរិច្ឆេទ៖ ${escapeHtml(dateStr)}</div>
<div>របៀបសំណេរ៖ ${escapeHtml(MODES[s.mode]?.km)} <span class="en">(${escapeHtml(MODES[s.mode]?.en)})</span></div>
<div>គោលវចនានុក្រម៖ ${escapeHtml(PROFILES[s.profile]?.km)}</div>
<div>ម៉ាស៊ីនពិនិត្យ៖ KhmerProof ${escapeHtml(s.engineVersion)} · ${toKhmerDigits((s.lexiconEntries || 0).toLocaleString('en'))} ពាក្យ</div>
${model.documentHash ? `<div>SHA-256៖ <span class="en">${escapeHtml(model.documentHash.slice(0, 32))}…</span></div>` : ''}
</div>
<div class="notice">KhmerProof ផ្ដល់សំណើ មិនមែនការវិនិច្ឆ័យចុងក្រោយទេ។ កម្រិតទំនុកចិត្តជាការប៉ាន់ស្មានរបស់វិធាននីមួយៗ មិនមែនប្រូបាប៊ីលីតេដែលបានវាស់វែងទេ។ ពាក្យដែលមិនមានក្នុងវចនានុក្រម មិនត្រូវបានចាត់ទុកថាខុសដោយស្វ័យប្រវត្តិទេ។${s.mode === 'legal' ? ' ក្នុងរបៀបច្បាប់ ការកែដែលអាចប៉ះពាល់ន័យច្បាប់ ត្រូវការការពិនិត្យដោយអ្នកជំនាញ។' : ''}
<div class="en">Suggestions, not final judgements. Confidence values are rule estimates, not measured probabilities.</div></div>
<h2>សង្ខេប <span class="en">Summary</span></h2>
<p>សរុប ${toKhmerDigits(model.totals.all)} ចំណុច · មិនទាន់សម្រេច ${toKhmerDigits(model.totals.open)} · ទទួលយក ${toKhmerDigits(model.totals.accepted)} · បដិសេធ ${toKhmerDigits(model.totals.rejected)}</p>
${catRows ? `<table><thead><tr><th>ប្រភេទ</th><th>Category</th><th>ចំនួន</th></tr></thead><tbody>${catRows}</tbody></table>` : '<p>រកមិនឃើញបញ្ហាទេ។</p>'}
<h2>បញ្ជីលម្អិត <span class="en">Findings</span></h2>
${model.rows.length ? `<div class="table-wrap"><table><thead><tr><th>ល.រ</th><th>ទីតាំង</th><th>អត្ថបទដើម</th><th>ប្រភេទ</th><th>ការពន្យល់</th><th>សំណើកែ</th><th>ទំនុកចិត្ត</th><th>ប្រភពយោង</th><th>ស្ថានភាព</th></tr></thead><tbody>
${rows}
</tbody></table></div>` : '<p>គ្មានចំណុចត្រូវរាយការណ៍។</p>'}
${model.fullText !== null ? `<h2>អត្ថបទដែលបានពិនិត្យ <span class="en">Reviewed text</span></h2><div class="full">${escapeHtml(model.fullText)}</div>` : ''}
<p class="en" style="margin-top:24px">Sources: Chuon Nath Khmer Dictionary (Buddhist Institute 1967; Open Institute digital edition, LGPL-2.1); SBBIC Khmer word list; KhmerProof curated lists. Generated by KhmerProof ${escapeHtml(s.engineVersion)}.</p>
</main>${forPrint ? '' : ''}</body></html>`;
}
