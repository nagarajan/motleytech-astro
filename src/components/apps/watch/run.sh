#!/bin/sh
# Scratch harness runner: bundles a TS entry point and runs it in node, so that the
# movement can be exercised outside the browser. Not part of the site build.
set -e
cd "$(dirname "$0")"
ROOT=../../../..
ENTRY="${1:-check.ts}"
"$ROOT/node_modules/.bin/esbuild" "$ENTRY" --bundle --platform=node --format=esm \
  --outfile=/tmp/watch-check.mjs --log-level=warning
node /tmp/watch-check.mjs
