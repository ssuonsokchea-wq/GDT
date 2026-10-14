# Publishing KhmerProof as a public website

There are two ways to publish. Choose by the features you need.

| | Static site (GitHub Pages, Cloudflare Pages) | Full server (Docker on Render, Railway, Fly.io or a VPS) |
|---|---|---|
| Cost | Free | Free tiers exist but sleep when idle; small paid plans otherwise |
| Spelling, grammar, all modes | Yes | Yes |
| TXT and DOCX upload, corrected DOCX | Yes | Yes |
| HTML, CSV, Word reports | Yes | Yes |
| PDF report | Browser print → Save as PDF | Direct download, Khmer font embedded |
| PDF upload | In the browser (pdf.js); many Khmer PDFs extract poorly | Server `pdftotext`, much more reliable |
| AI contextual review | No | Optional, with your API key |
| Where text is processed | Only in the visitor's browser | In the browser; on the server only after the visitor consents |

Before publishing either way: choose a licence for the code, and add a privacy notice and terms of use that fit your organisation. The about page (`public/about.html`) already credits the dictionary sources, which the LGPL-2.1 data licence requires; keep it.

## Option A: static site on GitHub Pages

1. Merge this work into the `main` branch of `ssuonsokchea-wq/GDT`.
2. On GitHub, open **Settings → Pages**, and under **Build and deployment → Source** choose **GitHub Actions**.
3. The workflow `.github/workflows/pages.yml` runs the tests, builds `dist/` and publishes it on every push to `main`. You can also start it by hand under **Actions → Deploy static site to GitHub Pages → Run workflow**.
4. The site appears at `https://ssuonsokchea-wq.github.io/GDT/`. All paths in the app are relative, so it works under that sub-path.

To build the same files yourself: `npm install && npm run build:static`, then upload `dist/` to any static host. On Cloudflare Pages, set the build command to `npm ci && npm run build:static` and the output directory to `dist`; the `_headers` file adds security headers.

## Option B: full server with Docker

The `Dockerfile` builds on the official Playwright image, which contains the Chromium build that matches `playwright-core` 1.56.1, and adds Poppler. **This image has not been built during development:** the build environment had no Docker daemon. Build it once locally, or let your host build it, and check `/api/status` before relying on it.

```bash
docker build -t khmerproof .
docker run --rm -p 8080:8080 khmerproof
# open http://localhost:8080 and check http://localhost:8080/api/status → "pdf": true, "pdfText": true
```

### Render (example host)

1. Sign in at <https://render.com>, choose **New → Web Service**, and connect the GitHub repository.
2. Render detects the `Dockerfile`. Choose a region near your users (Singapore for Cambodia).
3. Leave the start command empty, since the Dockerfile sets it. The container listens on port 8080; set the environment variable `PORT=8080` if Render asks.
4. Only if you want the AI review, add the environment variables `KHMERPROOF_AI=on` and `ANTHROPIC_API_KEY` in the service's **Environment** tab. Render stores them as secrets; they never reach the browser or the repository.
5. Render provides an `https://…onrender.com` address. A custom domain is optional.

Free instances sleep after inactivity, so the first visit after a pause takes longer. Each PDF report starts a Chromium page; on a small instance, keep `KHMERPROOF_PDF_CONCURRENCY=1`.

### A virtual server (VPS)

Install Node.js 20+, Poppler (`apt install poppler-utils`) and Chromium (`npx playwright-core install --with-deps chromium`), then run `npm ci && HOST=127.0.0.1 PORT=8080 npm start` under a process manager such as systemd. Put a reverse proxy that handles HTTPS in front of it, for example Caddy with the one-line Caddyfile `your.domain { reverse_proxy 127.0.0.1:8080 }`.

## Public-service checklist

- [ ] The AI review stays off unless you have a budget, and your terms explain that text goes to Anthropic.
- [ ] `ANTHROPIC_API_KEY` exists only in the host's secret settings, never in Git.
- [ ] The rate limits in `server/server.mjs` (20 PDF reports, 20 PDF extractions and 10 AI reviews per minute per address) suit your traffic.
- [ ] A privacy notice says that text is checked in the browser and when it is sent to the server.
- [ ] The about page and the LGPL-2.1 licence file are published with the dictionary data.
- [ ] You have read [LIMITATIONS.md](LIMITATIONS.md) and decided what users should be told about legal documents.
