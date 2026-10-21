#!/usr/bin/env bash

set -euo pipefail

web_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
if [[ $# -gt 0 ]]; then
  echo "Usage: ./web/run.sh (or ./run.sh web)"
  echo "Starts the local web app at http://127.0.0.1:8080 using the repository .env."
  echo "Override the port with ENERGYDECK_WEB_PORT. Press Ctrl+C to stop."
  [[ "$1" == "--help" || "$1" == "-h" ]] && exit 0
  exit 1
fi

if ! command -v node >/dev/null 2>&1 || ! node -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 22 ? 0 : 1)'; then
  echo "Node.js 22 or newer is required. Install it and try again."
  exit 1
fi

cd "$web_dir"
# Keep installation reproducible, and reinstall only when the lock file changes.
if [[ ! -d node_modules/fast-xml-parser ]] || ! cmp -s package-lock.json node_modules/.energydeck-package-lock.json; then
  if ! command -v npm >/dev/null 2>&1; then
    echo "npm is required to install the web app dependencies."
    exit 1
  fi
  npm ci --ignore-scripts --no-fund --no-audit
  cp package-lock.json node_modules/.energydeck-package-lock.json
fi

exec node local.mjs
