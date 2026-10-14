// The AI features, end to end, against a local MOCK of the Anthropic Messages API.
// This checks the wiring (button → consent → server → validation → accept); it says
// nothing about the quality of a real model's Khmer, which needs a real key to judge.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { chromium } from 'playwright-core';

const REPHRASED_OK = 'ក្រុមការងារបានពិភាក្សាម្ដងទៀត។';
const REPHRASED_BAD = 'ក្រុមការងារបានពិនិត្សម្ដងទៀត។'; // contains a misspelling: must be filtered out
let mock, server, browser, page;

test.before(async () => {
  mock = http.createServer((req, res) => {
    let body = '';
    req.on('data', c => { body += c; });
    req.on('end', () => {
      const system = JSON.parse(body).system || '';
      const payload = /Rewrite the passage/.test(system)
        ? { alternatives: [{ text: REPHRASED_OK, style: 'shorter', explanation_km: 'លុបពាក្យលើស។' }, { text: REPHRASED_BAD, style: 'clearer', explanation_km: 'x' }] }
        : { findings: [] };
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ id: 'msg_mock', type: 'message', role: 'assistant', model: 'mock', content: [{ type: 'text', text: JSON.stringify(payload) }],
        stop_reason: 'end_turn', stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } }));
    });
  });
  await new Promise(r => mock.listen(0, '127.0.0.1', r));
  Object.assign(process.env, { KHMERPROOF_AI: 'on', ANTHROPIC_API_KEY: 'test-key', ANTHROPIC_BASE_URL: `http://127.0.0.1:${mock.address().port}`, KHMERPROOF_LOG: 'off' });
  const { createServer } = await import('../../server/server.mjs');
  server = createServer();
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, args: ['--no-sandbox'] });
  page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  await page.waitForFunction(() => !document.getElementById('rephraseBtn').hidden && /វចនានុក្រម|ពិនិត្យរួច/.test(document.getElementById('engineStatus').textContent), null, { timeout: 30000 });
});
test.after(async () => { await browser?.close(); server?.closeAllConnections(); server?.close(); mock?.closeAllConnections(); mock?.close(); });

test('rephrase: selected sentence → validated alternatives → accepted into the text', async () => {
  const text = 'ក្រុមការងារបានធ្វើការពិភាក្សាជាថ្មីម្ដងទៀត។';
  await page.fill('#editor', text);
  await page.evaluate(() => { const e = document.getElementById('editor'); e.focus(); e.setSelectionRange(0, e.value.length); });
  await page.click('#rephraseBtn');
  await page.check('#consentCheck');
  await page.click('#consentOk');
  await page.waitForSelector('.rephrase-option');
  const options = await page.locator('.rephrase-option .text').allTextContents();
  assert.deepEqual(options, [REPHRASED_OK], 'the misspelled alternative was removed by local validation');
  await page.locator('.rephrase-option button').first().click();
  await page.waitForFunction(t => document.getElementById('editor').value === t, REPHRASED_OK);
  const d = await page.evaluate(() => window.__khmerproof.state.decisions.at(-1).finding.ruleId);
  assert.equal(d, 'ai.rephrase');
});

test('whole-sentence rewrite card offers the shortened sentence', async () => {
  await page.fill('#editor', 'ក្នុងពេលបច្ចុប្បន្ននេះ តម្លៃប្រេងមានការកើនឡើង ដើម្បីនឹងដោះស្រាយ ក្រុមការងារបានធ្វើការពិភាក្សាជាថ្មីម្ដងទៀត។');
  await page.waitForFunction(() => window.__khmerproof.state.findings.some(f => f.ruleId === 'clarity.rewrite'), null, { timeout: 15000 });
  await page.locator('.card', { hasText: 'ប្រើល្បះថ្មី' }).locator('button', { hasText: 'ប្រើល្បះថ្មី' }).click();
  await page.waitForFunction(() => document.getElementById('editor').value === 'បច្ចុប្បន្ននេះ តម្លៃប្រេងកើនឡើង ដើម្បីដោះស្រាយ ក្រុមការងារបានពិភាក្សាម្ដងទៀត។');
});
