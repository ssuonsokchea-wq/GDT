#!/bin/bash
# KhmerProof launcher for macOS. Requires Node.js 20+ (https://nodejs.org).
cd "$(dirname "$0")" || exit 1
if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is not installed. Download the LTS version from https://nodejs.org, install it, then open this file again."
  read -r -p "Press Return to close."
  exit 1
fi
if [ ! -d node_modules ]; then
  echo "Installing libraries (first run only)..."
  npm install || { read -r -p "Installation failed. Press Return to close."; exit 1; }
fi
export KHMERPROOF_OPEN=1
node server/server.mjs
read -r -p "KhmerProof stopped. Press Return to close."
