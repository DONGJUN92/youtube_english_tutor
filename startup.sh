#!/bin/sh
set -eu
cd /workspace
node scripts/preview.mjs stop || true
if ! curl -sf -o /dev/null --max-time 2 http://127.0.0.1:8080/; then
  npm run dev >>/tmp/app-startup.log 2>&1 &
fi
if [ ! -f /tmp/caption-relay.pid ] || ! kill -0 "$(cat /tmp/caption-relay.pid)" 2>/dev/null; then
  node scripts/live-caption-relay.mjs >>/tmp/caption-relay.log 2>&1 &
  echo $! >/tmp/caption-relay.pid
fi
exit 0
