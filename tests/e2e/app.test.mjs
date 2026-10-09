// End-to-end tests in a real Chromium browser against the real server.
// Run: npm run test:e2e   (needs Chromium: see README, "Running the tests")

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright-core';
import { unzipSync, strFromU8 } from 'fflate';
import { createServer } from '../../server/server.mjs';
import { writeTextDocx } from '../../engine/docx.js';

process.env.KHMERPROOF_LOG = 'off';
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kp-e2e-'));
let server, base, browser, page;
const errors = [];

test.before(async () => {
  server = createServer();
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}/`;
  browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, args: ['--no-sandbox'] });
  const context = await browser.newContext({ acceptDownloads: true, viewport: { width: 1366, height: 900 } });
  page = await context.newPage();
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(base);
  await page.waitForFunction(() => /វចនានុក្រម|ពិនិត្យរួច/.test(document.getElementById('engineStatus').textContent), null, { timeout: 30000 });
});
test.after(async () => { await browser?.close(); server?.close(); fs.rmSync(tmp, { recursive: true, force: true }); });

async function typeText(text) {
  await page.fill('#editor', text);
  await page.waitForFunction(t => window.__khmerproof.state.checkedText === t, text, { timeout: 15000 });
  await page.waitForTimeout(50);
}
const findings = () => page.evaluate(() => window.__khmerproof.state.findings.map(f => ({ id: f.id, original: f.original, category: f.category, ruleId: f.ruleId, suggestions: f.suggestions })));
async function download(kind) {
  const [dl] = await Promise.all([page.waitForEvent('download'), page.evaluate(k => { document.getElementById('exportMenu').open = true; document.querySelector(`[data-export="${k}"]`).click(); }, kind)]);
  const file = path.join(tmp, dl.suggestedFilename());
  await dl.saveAs(file);
  return file;
}

test('(a) the obvious mistake «ខ្ងុំ» is underlined in the editor', async () => {
  await typeText('ខ្ងុំទៅសាលារៀន។');
  const marks = await page.locator('#backdrop mark').allTextContents();
  assert.ok(marks.includes('ខ្ងុំ'));
  const f = (await findings()).find(x => x.original === 'ខ្ងុំ');
  assert.equal(f.suggestions[0], 'ខ្ញុំ');
});

test('(b) accepting a suggestion changes exactly that span; undo restores it', async () => {
  await typeText('សូមអនុញ្ញាតិឱ្យខ្ញុំនិយាយ។');
  await page.locator('.card .actions button').first().click();
  await page.waitForFunction(() => document.getElementById('editor').value === 'សូមអនុញ្ញាតឱ្យខ្ញុំនិយាយ។');
  await page.click('#undoBtn');
  await page.waitForFunction(() => document.getElementById('editor').value === 'សូមអនុញ្ញាតិឱ្យខ្ញុំនិយាយ។');
});

test('(c) rejecting a finding removes it and records the decision', async () => {
  await typeText('ខ្ញុំនិងទៅផ្សារ។');
  const before = await page.locator('.card').count();
  await page.locator('.card .actions button', { hasText: 'បដិសេធ' }).first().click();
  assert.equal(await page.locator('.card').count(), before - 1);
  const d = await page.evaluate(() => window.__khmerproof.state.decisions.at(-1).status);
  assert.equal(d, 'rejected');
});

test('(d) grammar heuristics are labelled with a KhmerProof source, not presented as the textbook', async () => {
  await typeText('ខ្ញុំសាលារៀនទៅ។');
  const src = await page.evaluate(() => window.__khmerproof.state.findings.find(f => f.category === 'structure').source.en);
  assert.match(src, /KhmerProof grammar rule \(not yet verified/);
});

test('(e) writing mode changes register advice', async () => {
  await page.selectOption('#mode', 'general');
  await typeText('ក្រសួងអត់មានថវិកាទេ។');
  assert.ok(!(await findings()).some(f => f.ruleId === 'wording.register'));
  await page.selectOption('#mode', 'government');
  await page.waitForFunction(() => window.__khmerproof.state.findings.some(f => f.ruleId === 'wording.register'), null, { timeout: 10000 });
  await page.selectOption('#mode', 'general');
});

test('(f) TXT and DOCX upload work, with a layout notice for DOCX', async () => {
  const txt = path.join(tmp, 'in.txt');
  fs.writeFileSync(txt, '﻿ពួកយើងបានពិនិត្សឯកសារ។\r\n');
  await page.setInputFiles('#fileInput', txt);
  await page.waitForFunction(() => document.getElementById('editor').value.startsWith('ពួកយើង'));
  const docx = path.join(tmp, 'in.docx');
  fs.writeFileSync(docx, writeTextDocx('ខ្ងុំទៅសាលារៀន។\nកថាខណ្ឌទីពីរ។'));
  await page.setInputFiles('#fileInput', docx);
  await page.waitForFunction(() => document.getElementById('editor').value === 'ខ្ងុំទៅសាលារៀន។\nកថាខណ្ឌទីពីរ។');
  assert.match(await page.locator('#notices').textContent(), /ទ្រង់ទ្រាយដើម/);
});

test('(g) CSV, HTML and DOCX reports download and keep Khmer text and required fields', async () => {
  await page.waitForFunction(() => window.__khmerproof.state.findings.some(f => f.original === 'ខ្ងុំ'));
  const csv = fs.readFileSync(await download('csv'), 'utf8');
  assert.ok(csv.startsWith('﻿'), 'CSV has a BOM for Excel');
  for (const h of ['Original passage', 'Paragraph', 'Category', 'Explanation (Khmer)', 'Suggested correction', 'Confidence', 'Source']) assert.ok(csv.includes(h), h);
  assert.ok(csv.includes('ខ្ងុំ') && csv.includes('ខ្ញុំ'));
  const html = fs.readFileSync(await download('html'), 'utf8');
  assert.ok(html.includes('<mark>ខ្ងុំ</mark>') && html.includes('ជួន ណាត'));
  assert.ok(!/<script/i.test(html), 'report contains no scripts');
  const docx = unzipSync(new Uint8Array(fs.readFileSync(await download('docx'))));
  const xml = strFromU8(docx['word/document.xml']);
  assert.ok(xml.includes('ខ្ងុំ') && xml.includes('ខ្ញុំ') && xml.includes('w:highlight'));
});

test('(h) PDF report is generated with an embedded Khmer font', async () => {
  page.once('dialog', d => d.accept());
  const dlPromise = page.waitForEvent('download', { timeout: 30000 });
  await page.evaluate(() => { document.getElementById('exportMenu').open = true; document.querySelector('[data-export="pdf"]').click(); });
  await page.check('#consentCheck');
  await page.click('#consentOk');
  const dl = await dlPromise;
  const file = path.join(tmp, 'report.pdf');
  await dl.saveAs(file);
  const pdf = fs.readFileSync(file).toString('latin1');
  assert.ok(pdf.startsWith('%PDF-'));
  assert.ok(pdf.includes('NotoSansKhmer'), 'Khmer font embedded');
});

test('(i) corrected DOCX keeps the original runs and contains only accepted edits', async () => {
  const card = page.locator('.card', { hasText: 'ខ្ងុំ' }).first();
  await card.locator('.actions button').first().click();
  await page.waitForFunction(() => document.getElementById('editor').value.startsWith('ខ្ញុំ'));
  const docx = unzipSync(new Uint8Array(fs.readFileSync(await download('corrected-docx'))));
  const xml = strFromU8(docx['word/document.xml']);
  assert.ok(xml.includes('ខ្ញុំទៅសាលារៀន។') && !xml.includes('ខ្ងុំ'));
  assert.ok(xml.includes('កថាខណ្ឌទីពីរ។'));
});

test('(j) PDF upload extracts Khmer text through the server', async () => {
  const pdf = path.join(tmp, 'report.pdf');
  await page.setInputFiles('#fileInput', pdf);
  await page.check('#consentCheck');
  await page.click('#consentOk');
  await page.waitForFunction(() => document.getElementById('editor').value.includes('ពិនិត្យអក្ខរាវិរុទ្ធ'), null, { timeout: 30000 });
});

test('(k) the page makes no third-party requests and shows no errors', async () => {
  const hosts = new Set();
  page.on('request', r => hosts.add(new URL(r.url()).host));
  await page.reload();
  await page.waitForFunction(() => /វចនានុក្រម|ពិនិត្យរួច/.test(document.getElementById('engineStatus').textContent), null, { timeout: 30000 });
  await typeText('ខ្ញុំទៅសាលារៀន។');
  for (const h of hosts) assert.ok(h === '' || h.startsWith('127.0.0.1'), `unexpected host ${h}`);
  assert.deepEqual(errors, []);
});

test('(l) mobile layout has no horizontal scrolling', async () => {
  await page.setViewportSize({ width: 360, height: 780 });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  assert.ok(overflow <= 0, `page is ${overflow}px wider than the viewport`);
  await page.setViewportSize({ width: 1366, height: 900 });
});
