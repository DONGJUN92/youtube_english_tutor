#!/bin/sh
set -eu
cd /workspace
node scripts/preview.mjs stop || true
if ! curl -sf -o /dev/null --max-time 2 http://127.0.0.1:8080/; then
  npm run dev >>/tmp/app-startup.log 2>&1 &
fi
if ! pgrep -f "scripts/live-caption-relay.mjs" >/dev/null 2>&1; then
  node scripts/live-caption-relay.mjs >>/tmp/caption-relay.log 2>&1 &
fi
exit 0
