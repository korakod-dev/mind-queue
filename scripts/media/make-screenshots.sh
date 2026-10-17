#!/usr/bin/env bash
# Recapture docs/screenshots from a live local game (needs `npm run dev` running).
# ⚠ Resets the room. Never run against production during a class.
set -euo pipefail
cd "$(dirname "$0")"
node reset.mjs
node bots.mjs 45 & BOTS=$!
trap 'kill $BOTS 2>/dev/null || true' EXIT
sleep 1
node shots.mjs
kill $BOTS 2>/dev/null || true
wait $BOTS 2>/dev/null || true
sleep 1
node reset.mjs
node win.mjs                       # solo game so the phone is queue #1 → real winner screen
rm -f ../../docs/screenshots/phone-win-alt.jpg
# online-mode pass
node reset.mjs
node bots.mjs 30 & BOTS=$!
sleep 1
node shots-online.mjs
kill $BOTS 2>/dev/null || true
wait $BOTS 2>/dev/null || true
sleep 1
node reset.mjs
node win-online.mjs
echo "screenshots updated in docs/screenshots/"
