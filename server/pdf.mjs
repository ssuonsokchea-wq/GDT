// HTML → PDF with headless Chromium, which shapes Khmer correctly (HarfBuzz) and embeds
// the Noto Sans Khmer font in the PDF. The page is rendered with JavaScript disabled and
// every network request blocked, so a report can never fetch anything.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FONT_DIR = path.join(ROOT, 'node_modules', '@fontsource', 'noto-sans-khmer', 'files');

let fontCss = null;
export function embeddedFontCss() {
  if (fontCss !== null) return fontCss;
  const faces = [];
  for (const weight of [400, 700]) {
    for (const [subset, range] of [['khmer', 'U+1780-17FF,U+19E0-19FF,U+200B-200D,U+25CC'], ['latin', 'U+0000-00FF,U+2000-206F,U+20AC,U+2122']]) {
      const file = path.join(FONT_DIR, `noto-sans-khmer-${subset}-${weight}-normal.woff2`);
      if (!fs.existsSync(file)) continue;
      faces.push(`@font-face{font-family:"Noto Sans Khmer";font-weight:${weight};font-style:normal;unicode-range:${range};src:url(data:font/woff2;base64,${fs.readFileSync(file).toString('base64')}) format("woff2")}`);
    }
  }
  fontCss = faces.join('\n');
  return fontCss;
}

let browserPromise = null;
async function browser() {
  if (!browserPromise) {
    const executablePath = process.env.CHROMIUM_PATH || undefined;
    browserPromise = chromium.launch({ executablePath, args: ['--no-sandbox', '--disable-dev-shm-usage'] }).catch(e => { browserPromise = null; throw e; });
  }
  return browserPromise;
}

export async function pdfAvailable() {
  try { await browser(); return true; } catch { return false; }
}

let active = 0;
const MAX_CONCURRENT = Number(process.env.KHMERPROOF_PDF_CONCURRENCY || 2);

/** Render a complete HTML document to PDF bytes. */
export async function htmlToPdf(html) {
  if (active >= MAX_CONCURRENT) throw Object.assign(new Error('PDF renderer busy, try again shortly'), { status: 503 });
  active++;
  let context = null;
  try {
    const b = await browser();
    context = await b.newContext({ javaScriptEnabled: false, colorScheme: 'light' });
    await context.route('**/*', route => route.request().url().startsWith('data:') ? route.continue() : route.abort());
    const page = await context.newPage();
    await page.setContent(html, { waitUntil: 'load', timeout: 30000 });
    return await page.pdf({ format: 'A4', landscape: true, printBackground: true, margin: { top: '12mm', bottom: '14mm', left: '10mm', right: '10mm' },
      displayHeaderFooter: true, headerTemplate: '<span></span>',
      footerTemplate: '<div style="font-size:8px;width:100%;text-align:center;color:#666">KhmerProof · <span class="pageNumber"></span> / <span class="totalPages"></span></div>' });
  } finally {
    active--;
    await context?.close();
  }
}

export async function closeBrowser() {
  if (browserPromise) { const b = await browserPromise.catch(() => null); browserPromise = null; await b?.close(); }
}
