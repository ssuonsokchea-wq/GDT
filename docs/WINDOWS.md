# Installing KhmerProof on Windows

These steps run KhmerProof on your own computer, at `http://localhost:8080`. Only your computer can reach it, and your documents stay on it. They were written for Windows 10 and 11 using PowerShell. The Node.js parts were tested on Linux; the Windows steps follow the standard installers, so report any step that differs on your machine.

## 1. Install the required programs

1. **Node.js 20 or later.** Download the "LTS" Windows Installer (`.msi`) from <https://nodejs.org/> and run it with the default options. Open a new PowerShell window and check:
   ```powershell
   node -v      # should print v20 or higher
   npm -v
   ```
2. **Git** (to download and update the code). Install it from <https://git-scm.com/download/win> with the default options. Without Git, you can instead use the green **Code → Download ZIP** button on GitHub and unzip the folder.

## 2. Download and start KhmerProof

```powershell
cd $HOME\Documents
git clone https://github.com/ssuonsokchea-wq/GDT.git khmerproof
cd khmerproof
npm install
npm start
```

`npm install` downloads the libraries (about 60 MB) and copies the browser files into `public\vendor`. When `npm start` prints `KhmerProof 1.0.0 running at http://127.0.0.1:8080/`, open that address in Chrome, Edge or Firefox. To stop the server, press `Ctrl+C` in PowerShell.

Spelling, grammar, TXT and DOCX upload, and the HTML, CSV and Word reports now work.

## 3. Optional: PDF reports

PDF reports are drawn by Chromium, which shapes Khmer text correctly and embeds the font. Download it once (about 150 MB):

```powershell
npm run setup:pdf
```

Without it, the **PDF** button opens the report in a new tab; choose **Print → Save as PDF** there.

## 4. Optional: reliable PDF uploads

Many Khmer PDFs store their text in a way that browser PDF readers decode wrongly: vowels end up out of order and subscripts disappear. Poppler's `pdftotext` reads such files correctly. To use it:

1. Download a Poppler build for Windows, for example from <https://github.com/oschwartz10612/poppler-windows/releases>, and unzip it to `C:\poppler`.
2. Add its `bin` folder (for example `C:\poppler\Library\bin`) to **Settings → System → About → Advanced system settings → Environment Variables → Path**, or set it only for KhmerProof:
   ```powershell
   $env:PDFTOTEXT_PATH = "C:\poppler\Library\bin\pdftotext.exe"
   npm start
   ```

Scanned PDFs contain images, not text. Run OCR on them first; see [TEXTBOOK.md](TEXTBOOK.md).

## 5. Khmer fonts for Word reports

The web app includes the Noto Sans Khmer font. Word reports ask for **Khmer OS Siemreap**. If that font is not installed, Word substitutes another Khmer font, usually Khmer UI or Leelawadee UI. The free Khmer OS fonts are widely available in Cambodia; installing them gives reports the usual government look.

## 6. Optional: AI contextual review

This sends text to Anthropic, so leave it off for confidential documents unless your organisation allows it. To turn it on for this session only:

```powershell
$env:KHMERPROOF_AI = "on"
$env:ANTHROPIC_API_KEY = "sk-ant-..."     # never put the key in a file you commit
npm start
```

## 7. Optional: run the tests

```powershell
npm test               # unit and regression tests
npm run evaluate       # accuracy report → docs\EVALUATION.md
npm run setup:pdf
npm run test:e2e       # browser tests (PDF upload test needs pdftotext)
```

## Command line

```powershell
node bin\khmerproof.mjs check "C:\path\letter.docx" --mode government --report pdf,docx,csv,html --out reports
```

## Updating

```powershell
cd $HOME\Documents\khmerproof
git pull
npm install
```

## Troubleshooting

| Problem | Fix |
|---|---|
| `node` is not recognised | Close and reopen PowerShell after installing Node.js. |
| Port 8080 is in use | `$env:PORT = 8081; npm start` |
| `running scripts is disabled on this system` when running `npm` | Run `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned` once, or use `npm.cmd` instead of `npm`. |
| PDF button opens a print tab instead of downloading | Run `npm run setup:pdf`, then restart the server. |
| Khmer looks broken in a PDF upload | Install Poppler (step 4), or open the original Word file instead. |
| Another computer on the network cannot open the app | By design the server listens only on this computer. To share it on a trusted network: `$env:HOST = "0.0.0.0"; npm start`. Do not do this on public Wi-Fi. |
