# KhmerProof full server: app + PDF reports (Chromium) + PDF text extraction (Poppler).
# The Playwright image ships the Chromium build that matches playwright-core 1.56.1.
FROM mcr.microsoft.com/playwright:v1.56.1-noble

RUN apt-get update \
 && apt-get install -y --no-install-recommends poppler-utils \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json package-lock.json ./
COPY scripts/copy-vendor.mjs scripts/copy-vendor.mjs
RUN npm ci --omit=dev && npm cache clean --force
COPY . .
RUN node scripts/copy-vendor.mjs

ENV NODE_ENV=production HOST=0.0.0.0 PORT=8080 PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
EXPOSE 8080
USER pwuser
HEALTHCHECK --interval=30s --timeout=5s CMD node -e "fetch('http://127.0.0.1:8080/api/status').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server/server.mjs"]
