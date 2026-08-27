#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SOURCE_URL="https://bcr.pbh-btn.com/combine/all.txt"
TARGET="$ROOT_DIR/src-tauri/data/bt-peer-blocklist.txt"
TEMP_FILE="$(mktemp)"

trap 'rm -f "$TEMP_FILE"' EXIT
curl --fail --location --silent --show-error --max-time 30 "$SOURCE_URL" --output "$TEMP_FILE"
test -s "$TEMP_FILE"
mv "$TEMP_FILE" "$TARGET"
