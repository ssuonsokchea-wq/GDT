import asyncio, os, zipfile, csv
from pathlib import Path
from playwright.async_api import async_playwright

SITE=Path(__file__).resolve().parent.parent
OUT=SITE/'_test_outputs';OUT.mkdir(exist_ok=True)
async def run():
 async with async_playwright() as p:
  browser=await p.chromium.launch(headless=True, executable_path='/usr/bin/chromium', args=['--no-sandbox'])
  context=await browser.new_context(accept_downloads=True, viewport={'width':1440,'height':1000})
  page=await context.new_page();errors=[]
  page.on('pageerror',lambda e: errors.append(str(e)))
  site=SITE
  html= (site/'index.html').read_text(encoding='utf-8')
  import re
  html = re.sub(r'<script defer src="[^"]+"></script>', '', html)
  await page.set_content(html,wait_until='domcontentloaded')
  await page.add_style_tag(path=str(site/'style.css'))
  for script in ['checker.js','docx.js','app.js']:
   await page.add_script_tag(path=str(site/script))
  print('Title',await page.title())
  await page.locator('#sampleBtn').click()
  await page.wait_for_timeout(500)
  print('Sample total',await page.locator('#issueTotal').inner_text())
  assert int(await page.locator('#issueTotal').inner_text())>=5
  await page.screenshot(path=str(OUT/'desktop.png'),full_page=True)
  print('Paragraph issue cards', await page.locator('.issue-card').count())
  assert (await page.locator('.issue-card').count())>=5
  async with page.expect_download() as dl:
   await page.locator('#downloadHtml').click()
  download=await dl.value; await download.save_as(OUT/'report.html')
  text=(OUT/'report.html').read_text(encoding='utf-8');assert 'របាយការណ៍' in text
  async with page.expect_download() as dl:
   await page.locator('#downloadCsv').click()
  download=await dl.value; await download.save_as(OUT/'report.csv')
  csvtxt=(OUT/'report.csv').read_text(encoding='utf-8-sig'); assert 'សួរស្តី' in csvtxt
  async with page.expect_download() as dl:
   await page.locator('#downloadDocx').click()
  download=await dl.value;await download.save_as(OUT/'report.docx')
  with zipfile.ZipFile(OUT/'report.docx') as z:
   word=z.read('word/document.xml').decode('utf-8'); assert 'សួរស្តី' in word
   print('DOCX archive checks',z.testzip())
  before=await page.locator('#editor').input_value()
  await page.locator('.issue-card .apply-btn').first.click()
  after=await page.locator('#editor').input_value()
  print('Accept changed content?',before!=after)
  assert before!=after
  # test upload produced DOCX and correct parsing
  await page.locator('#textFile').set_input_files(str(OUT/'report.docx'))
  await page.wait_for_timeout(750)
  print('DOCX imported prefix', (await page.locator('#editor').input_value())[:90])
  assert 'របាយការណ៍' in (await page.locator('#editor').input_value())
  # import dictionary test without external network
  dict_words=('\n'.join([f'ពាក្យ{i}ខ្មែរ' for i in range(1150)]))
  await page.locator('#dictFile').set_input_files({'name':'dictionary.csv','mimeType':'text/csv','buffer':dict_words.encode('utf-8')})
  await page.wait_for_timeout(450)
  status=await page.locator('#dictionaryStatus').inner_text()
  print('Dictionary status',status)
  assert any(ch.isdigit() for ch in status) and 'ពាក្យ' in status
  # viewer filtered
  await page.locator('[data-filter="high"]').click()
  await page.locator('#mode').select_option('formal')
  # test mobile layout
  await page.set_viewport_size({'width':390,'height':844})
  await page.screenshot(path=str(OUT/'mobile.png'),full_page=True)
  await page.locator('#sampleBtn').click()
  await page.wait_for_timeout(350)
  print('Mobile visible',await page.locator('#editor').is_visible())
  print('JS errors', errors)
  assert not errors, errors
  await browser.close()

asyncio.run(run())
