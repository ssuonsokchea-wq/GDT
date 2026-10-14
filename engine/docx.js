// DOCX import and export without a DOM, so the same code runs in browsers and Node.js.
//
// Import extracts paragraph text from word/document.xml and remembers where each piece
// of text sits in the XML. That map lets KhmerProof write a corrected copy of the
// *original* file: accepted changes are spliced into the existing runs, so fonts, styles,
// tables and headers survive. When the edits cannot be mapped (e.g. paragraphs were
// added or removed by hand), the caller falls back to a plain DOCX and says so.

import { unzipSync, zipSync, strToU8, strFromU8 } from 'fflate';
import { CATEGORIES, SEVERITIES, CONFIDENCE_KM } from './finding.js';
import { STATUS_KM } from './report.js';
import { MODES } from './analyzer.js';
import { toKhmerDigits } from './chars.js';

export const DOCX_LIMITS = { maxCompressed: 25 * 1024 * 1024, maxUncompressed: 80 * 1024 * 1024, maxEntries: 3000, maxTextChars: 300000 };
const KHMER_FONT = 'Khmer OS Siemreap';

const xmlEscape = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const xmlUnescape = s => s.replace(/&(lt|gt|amp|quot|apos|#\d+|#x[0-9a-fA-F]+);/g, (m, e) =>
  e === 'lt' ? '<' : e === 'gt' ? '>' : e === 'amp' ? '&' : e === 'quot' ? '"' : e === 'apos' ? "'" : e[1] === 'x' ? String.fromCodePoint(parseInt(e.slice(2), 16)) : String.fromCodePoint(Number(e.slice(1))));

/** Unzip with limits that defeat ZIP bombs and oversized archives. */
export function safeUnzip(bytes) {
  if (bytes.length > DOCX_LIMITS.maxCompressed) throw new Error('ឯកសារធំពេក (លើស 25 MB)');
  let total = 0, count = 0;
  const files = unzipSync(bytes, {
    filter(file) {
      count++;
      total += file.originalSize;
      if (count > DOCX_LIMITS.maxEntries || total > DOCX_LIMITS.maxUncompressed) throw new Error('ឯកសារ DOCX មានទំហំពេលពន្លាធំពេក ឬមិនត្រឹមត្រូវ');
      return true;
    },
  });
  return files;
}

/**
 * Read a DOCX file.
 * @param {Uint8Array} bytes
 * @returns {{text:string, paragraphs:Array, files:object, xml:string, warnings:string[]}}
 */
export function readDocx(bytes) {
  const files = safeUnzip(bytes);
  const doc = files['word/document.xml'];
  if (!doc) throw new Error('មិនមែនជាឯកសារ Word (.docx) ត្រឹមត្រូវទេ');
  const xml = strFromU8(doc);
  const warnings = [];
  if (/<w:ins\b|<w:del\b/.test(xml)) warnings.push('ឯកសារមានការកែប្រែតាមដាន (tracked changes)។ KhmerProof អានតែអត្ថបទដែលមិនត្រូវបានលុប។');
  if (/<w:txbxContent\b/.test(xml)) warnings.push('អត្ថបទក្នុងប្រអប់អត្ថបទ (text box) អាចមិនមានលំដាប់ដូចក្នុងឯកសារដើម។');
  const paragraphs = [];
  let cur = null;
  const re = /<w:p\/>|<w:p(?=[\s>])[^>]*>|<\/w:p>|<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>|<w:t\/>|<w:tab\/>|<w:br\/>|<w:br\s[^>]*\/>|<w:cr\/>/g;
  let m;
  const stack = [];
  while ((m = re.exec(xml))) {
    const tag = m[0];
    if (tag === '<w:p/>') { paragraphs.push({ segments: [], text: '' }); continue; }
    if (tag.startsWith('<w:p')) { cur = { segments: [], text: '' }; stack.push(cur); paragraphs.push(cur); continue; }
    if (tag === '</w:p>') { stack.pop(); cur = stack[stack.length - 1] || null; continue; }
    if (!cur) continue;
    if (tag.startsWith('<w:t')) {
      if (m[1] === undefined) continue;
      const contentStart = m.index + tag.indexOf('>') + 1;
      const text = xmlUnescape(m[1]);
      cur.segments.push({ kind: 'text', xmlStart: contentStart, xmlEnd: contentStart + m[1].length, textStart: cur.text.length, text, tag });
      cur.text += text;
    } else {
      const ch = tag.startsWith('<w:tab') ? '\t' : '\n';
      cur.segments.push({ kind: 'fixed', textStart: cur.text.length, text: ch });
      cur.text += ch;
    }
  }
  const text = paragraphs.map(p => p.text).join('\n');
  if (text.length > DOCX_LIMITS.maxTextChars) warnings.push('ឯកសារវែងពេក។ KhmerProof ពិនិត្យតែផ្នែកដំបូង។');
  return { text, paragraphs, files, xml, warnings };
}

/** Character-level diff of two short strings: returns [{aStart, aEnd, b}] change regions. */
export function diffRegions(a, b) {
  let pre = 0;
  while (pre < a.length && pre < b.length && a[pre] === b[pre]) pre++;
  let suf = 0;
  while (suf < a.length - pre && suf < b.length - pre && a[a.length - 1 - suf] === b[b.length - 1 - suf]) suf++;
  const A = a.slice(pre, a.length - suf), B = b.slice(pre, b.length - suf);
  if (!A && !B) return [];
  if (A.length * B.length > 4e6) return [{ aStart: pre, aEnd: a.length - suf, b: B }];
  // LCS table to split one large change into several local ones (keeps run formatting)
  const n = A.length, m = B.length;
  const dp = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i][j] = A[i] === B[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const regions = [];
  let i = 0, j = 0, open = null;
  while (i < n || j < m) {
    if (i < n && j < m && A[i] === B[j]) { if (open) { regions.push(open); open = null; } i++; j++; }
    else {
      if (!open) open = { aStart: pre + i, aEnd: pre + i, b: '' };
      if (j < m && (i >= n || dp[i][j + 1] >= dp[i + 1][j])) { open.b += B[j]; j++; }
      else { i++; open.aEnd = pre + i; }
    }
  }
  if (open) regions.push(open);
  return regions;
}

/**
 * Write the corrected text back into the original DOCX.
 * @returns {{bytes: Uint8Array|null, preserved: boolean, reason?: string}}
 */
export function writeCorrectedDocx(imported, finalText) {
  const finalParas = finalText.split('\n');
  if (finalParas.length !== imported.paragraphs.length) {
    return { bytes: null, preserved: false, reason: 'ចំនួនកថាខណ្ឌបានផ្លាស់ប្ដូរ ដូច្នេះមិនអាចរក្សាទ្រង់ទ្រាយដើមបានទេ' };
  }
  const edits = []; // [xmlStart, xmlEnd, newXmlText]
  for (let p = 0; p < finalParas.length; p++) {
    const para = imported.paragraphs[p];
    if (para.text === finalParas[p]) continue;
    const regions = diffRegions(para.text, finalParas[p]);
    // apply per region onto text segments
    const segs = para.segments.filter(s => s.kind === 'text').map(s => ({ ...s, newText: s.text }));
    for (const r of regions.reverse()) {
      const touched = segs.filter(s => s.textStart < r.aEnd && s.textStart + s.text.length > r.aStart ||
        (r.aStart === r.aEnd && s.textStart <= r.aStart && s.textStart + s.text.length >= r.aStart));
      if (!touched.length) {
        // insertion at a boundary with no text segment (e.g. after a tab): attach to the nearest preceding segment
        const before = [...segs].reverse().find(s => s.textStart + s.text.length <= r.aStart);
        if (!before) return { bytes: null, preserved: false, reason: 'មិនអាចកំណត់ទីតាំងការកែក្នុងឯកសារដើម' };
        before.newText += r.b;
        continue;
      }
      const first = touched[0], last = touched[touched.length - 1];
      const firstOff = Math.max(0, r.aStart - first.textStart);
      const lastOff = Math.min(last.text.length, r.aEnd - last.textStart);
      if (first === last) {
        first.newText = first.newText.slice(0, firstOff) + r.b + first.newText.slice(lastOff + (first.newText.length - first.text.length));
      } else {
        first.newText = first.newText.slice(0, firstOff) + r.b;
        for (const mid of touched.slice(1, -1)) mid.newText = '';
        last.newText = last.newText.slice(lastOff + (last.newText.length - last.text.length));
      }
    }
    for (const s of segs) if (s.newText !== s.text) edits.push([s.xmlStart, s.xmlEnd, xmlEscape(s.newText), s]);
  }
  let xml = imported.xml;
  edits.sort((a, b) => b[0] - a[0]);
  for (const [s, e, t] of edits) xml = xml.slice(0, s) + t + xml.slice(e);
  // runs whose text now starts or ends with a space need xml:space="preserve"
  xml = xml.replace(/<w:t>([^<]*)<\/w:t>/g, (all, t) => /^\s|\s$/.test(t) ? `<w:t xml:space="preserve">${t}</w:t>` : all);
  const files = { ...imported.files, 'word/document.xml': strToU8(xml) };
  const bytes = zipSync(files, { level: 6 });
  // Verify: the corrected file must read back as exactly the corrected text.
  if (readDocx(bytes).text !== finalText) return { bytes: null, preserved: false, reason: 'ការកែខ្លះប៉ះនឹងសញ្ញាដកឃ្លា (tab) ឬការចុះបន្ទាត់ក្នុងឯកសារដើម' };
  return { bytes, preserved: true };
}

// ---------- writing new documents ----------

function run(text, { bold = false, size = 20, highlight = null, color = null } = {}) {
  const props = `<w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:eastAsia="${KHMER_FONT}" w:cs="${KHMER_FONT}"/>${bold ? '<w:b/><w:bCs/>' : ''}${color ? `<w:color w:val="${color}"/>` : ''}<w:sz w:val="${size}"/><w:szCs w:val="${size}"/>${highlight ? `<w:highlight w:val="${highlight}"/>` : ''}<w:lang w:val="en-US" w:bidi="km-KH"/></w:rPr>`;
  return String(text).split('\n').map((line, i) => `${i ? '<w:r><w:br/></w:r>' : ''}<w:r>${props}<w:t xml:space="preserve">${xmlEscape(line)}</w:t></w:r>`).join('');
}
const para = (runs, { align = null, spacing = 80, style = null } = {}) =>
  `<w:p><w:pPr>${style ? `<w:pStyle w:val="${style}"/>` : ''}<w:spacing w:after="${spacing}" w:line="300" w:lineRule="auto"/>${align ? `<w:jc w:val="${align}"/>` : ''}</w:pPr>${runs}</w:p>`;
const cell = (content, width, { header = false, shade = null } = {}) =>
  `<w:tc><w:tcPr><w:tcW w:w="${width}" w:type="dxa"/>${shade || header ? `<w:shd w:val="clear" w:color="auto" w:fill="${shade || 'DCE8F5'}"/>` : ''}</w:tcPr>${content || para('')}</w:tc>`;

function wrapDocument(body, { landscape = false } = {}) {
  const sect = landscape
    ? '<w:sectPr><w:pgSz w:w="16838" w:h="11906" w:orient="landscape"/><w:pgMar w:top="850" w:right="850" w:bottom="850" w:left="850" w:header="400" w:footer="400" w:gutter="0"/></w:sectPr>'
    : '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134" w:header="567" w:footer="567" w:gutter="0"/></w:sectPr>';
  const document = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><w:body>${body}${sect}</w:body></w:document>`;
  const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:eastAsia="${KHMER_FONT}" w:cs="${KHMER_FONT}"/><w:sz w:val="22"/><w:szCs w:val="22"/><w:lang w:val="en-US" w:bidi="km-KH"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="120" w:line="300" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>
<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:pPr><w:keepNext/><w:spacing w:before="240" w:after="120"/><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:b/><w:bCs/><w:color w:val="0B5CAD"/><w:sz w:val="32"/><w:szCs w:val="32"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/><w:pPr><w:keepNext/><w:spacing w:before="200" w:after="80"/><w:outlineLvl w:val="1"/></w:pPr><w:rPr><w:b/><w:bCs/><w:sz w:val="26"/><w:szCs w:val="26"/></w:rPr></w:style>
<w:style w:type="table" w:styleId="Grid"><w:name w:val="Table Grid"/><w:tblPr><w:tblBorders><w:top w:val="single" w:sz="4" w:color="A0A8B4"/><w:left w:val="single" w:sz="4" w:color="A0A8B4"/><w:bottom w:val="single" w:sz="4" w:color="A0A8B4"/><w:right w:val="single" w:sz="4" w:color="A0A8B4"/><w:insideH w:val="single" w:sz="4" w:color="A0A8B4"/><w:insideV w:val="single" w:sz="4" w:color="A0A8B4"/></w:tblBorders><w:tblCellMar><w:left w:w="80" w:type="dxa"/><w:right w:w="80" w:type="dxa"/></w:tblCellMar></w:tblPr></w:style>
</w:styles>`;
  const now = new Date().toISOString().slice(0, 19) + 'Z';
  const files = {
    '[Content_Types].xml': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>`),
    '_rels/.rels': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>`),
    'word/_rels/document.xml.rels': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`),
    'word/document.xml': strToU8(document),
    'word/styles.xml': strToU8(styles),
    'docProps/core.xml': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>KhmerProof</dc:title><dc:creator>KhmerProof</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">${now}</dcterms:created></cp:coreProperties>`),
  };
  return zipSync(files, { level: 6 });
}

/** Plain DOCX with one paragraph per line (used when the original layout is unavailable). */
export function writeTextDocx(text) {
  return wrapDocument(text.split('\n').map(line => para(run(line, { size: 24 }), { spacing: 120 })).join(''));
}

/** DOCX version of the flagged-issues report. */
export function writeReportDocx(model) {
  const s = model.settings;
  const out = [];
  out.push(para(run('របាយការណ៍ពិនិត្យអក្ខរាវិរុទ្ធ និងវេយ្យាករណ៍ខ្មែរ', { bold: true, size: 32, color: '0B5CAD' }), { style: 'Heading1' }));
  out.push(para(run('KhmerProof flagged-issues report', { size: 18, color: '5B6470' })));
  const meta = [
    ['ឯកសារ', model.documentName || model.title],
    ['កាលបរិច្ឆេទ', model.generatedAt.slice(0, 16).replace('T', ' ') + ' UTC'],
    ['របៀបសំណេរ', `${MODES[s.mode]?.km} (${MODES[s.mode]?.en})`],
    ['ម៉ាស៊ីនពិនិត្យ', `KhmerProof ${s.engineVersion} · ${(s.lexiconEntries || 0).toLocaleString('en')} ពាក្យ`],
    ...(model.documentHash ? [['SHA-256', model.documentHash]] : []),
    ['សរុប', `${model.totals.all} ចំណុច · មិនទាន់សម្រេច ${model.totals.open} · ទទួលយក ${model.totals.accepted} · បដិសេធ ${model.totals.rejected}`],
  ];
  for (const [k, v] of meta) out.push(para(run(k + '៖ ', { bold: true }) + run(v)));
  out.push(para(run('KhmerProof ផ្ដល់សំណើ មិនមែនការវិនិច្ឆ័យចុងក្រោយទេ។ កម្រិតទំនុកចិត្តជាការប៉ាន់ស្មានរបស់វិធាន មិនមែនប្រូបាប៊ីលីតេដែលបានវាស់វែងទេ។', { size: 18, color: '5B6470' })));
  out.push(para(run('បញ្ជីលម្អិត', { bold: true, size: 26 }), { style: 'Heading2' }));
  const widths = [500, 1400, 2900, 1300, 3400, 1700, 900, 2300, 1000];
  const head = ['ល.រ', 'ទីតាំង', 'អត្ថបទដើម', 'ប្រភេទ', 'ការពន្យល់', 'សំណើកែ', 'ទំនុកចិត្ត', 'ប្រភពយោង', 'ស្ថានភាព'];
  let rows = `<w:tr><w:trPr><w:tblHeader/></w:trPr>${head.map((h, i) => cell(para(run(h, { bold: true, size: 18 })), widths[i], { header: true })).join('')}</w:tr>`;
  for (const r of model.rows) {
    const ctx = r.context || r.original;
    const at = r.contextOffset ?? ctx.indexOf(r.original);
    const passage = at >= 0 && ctx.slice(at, at + r.original.length) === r.original
      ? run(ctx.slice(0, at), { size: 18 }) + run(r.original || '∅', { size: 18, highlight: 'yellow', bold: true }) + run(ctx.slice(at + r.original.length), { size: 18 })
      : run(ctx, { size: 18 });
    const loc = r.location ? `កថាខណ្ឌ ${toKhmerDigits(r.location.paragraph)}\nបន្ទាត់ ${toKhmerDigits(r.location.line)}, ជួរ ${toKhmerDigits(r.location.column)}` : '';
    const sug = r.status === 'accepted' && r.chosen !== null ? r.chosen : (r.suggestions || []).join(' / ');
    const src = [r.source?.km, r.source?.detail, r.source?.url].filter(Boolean).join('\n');
    const shade = r.status === 'accepted' ? 'E8F5EC' : r.status === 'rejected' ? 'F2F2F2' : null;
    const cells = [
      para(run(toKhmerDigits(r.no), { size: 18 })), para(run(loc, { size: 16 })), para(passage),
      para(run(CATEGORIES[r.category]?.km + '\n' + (SEVERITIES[r.severity]?.km || ''), { size: 18 })),
      para(run(r.explanation + (r.legalNote ? '\n' + r.legalNote : ''), { size: 18 })),
      para(run(sug || '—', { size: 18, bold: true })),
      para(run(`${toKhmerDigits(Math.round(r.confidence * 100))}%\n${CONFIDENCE_KM[r.confidenceLevel]}`, { size: 18 })),
      para(run(src, { size: 16 })), para(run(STATUS_KM[r.status], { size: 18 })),
    ];
    rows += `<w:tr><w:trPr><w:cantSplit/></w:trPr>${cells.map((c, i) => cell(c, widths[i], { shade })).join('')}</w:tr>`;
  }
  out.push(`<w:tbl><w:tblPr><w:tblStyle w:val="Grid"/><w:tblW w:w="0" w:type="auto"/><w:tblLayout w:type="fixed"/></w:tblPr><w:tblGrid>${widths.map(w => `<w:gridCol w:w="${w}"/>`).join('')}</w:tblGrid>${rows}</w:tbl>`);
  if (model.fullText !== null && model.fullText !== undefined) {
    out.push(para(run('អត្ថបទដែលបានពិនិត្យ', { bold: true, size: 26 }), { style: 'Heading2' }));
    for (const line of model.fullText.split('\n')) out.push(para(run(line)));
  }
  out.push(para(run('Sources: Chuon Nath Khmer Dictionary (Buddhist Institute 1967; Open Institute digital edition, LGPL-2.1); SBBIC Khmer word list; KhmerProof curated lists.', { size: 16, color: '5B6470' })));
  return wrapDocument(out.join(''), { landscape: true });
}
