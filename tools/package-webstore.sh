#!/usr/bin/env bash
# Builds a Chrome Web Store upload zip at dist/companion-<version>.zip
# containing ONLY manifest.json, icons/, and src/ (paths relative to the zip
# root, so unzipping produces a valid unpacked-extension layout).
#
# Usage: tools/package-webstore.sh
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

MANIFEST="manifest.json"
if [ ! -f "$MANIFEST" ]; then
  echo "error: $MANIFEST not found at repo root ($ROOT_DIR)" >&2
  exit 1
fi

# Refuse to package a manifest that still references the removed self-update
# subsystem — CWS prohibits self-updating extensions.
if grep -qi "updater" "$MANIFEST" || grep -qi "raw.githubusercontent" "$MANIFEST"; then
  echo "error: $MANIFEST still references 'updater' or 'raw.githubusercontent' — refusing to package." >&2
  exit 1
fi

VERSION="$(node -e "console.log(require('./manifest.json').version)" 2>/dev/null || true)"
if [ -z "$VERSION" ]; then
  # Fallback without node: crude grep/sed extraction of "version": "x.y.z".
  VERSION="$(grep -m1 '"version"' "$MANIFEST" | sed -E 's/.*"version"[[:space:]]*:[[:space:]]*"([^"]+)".*/\1/')"
fi
if [ -z "$VERSION" ]; then
  echo "error: could not read \"version\" from $MANIFEST" >&2
  exit 1
fi

DIST_DIR="$ROOT_DIR/dist"
ZIP_PATH="$DIST_DIR/companion-${VERSION}.zip"
mkdir -p "$DIST_DIR"
rm -f "$ZIP_PATH"

if [ ! -d "icons" ]; then
  echo "error: icons/ directory not found at repo root" >&2
  exit 1
fi
if [ ! -d "src" ]; then
  echo "error: src/ directory not found at repo root" >&2
  exit 1
fi

if command -v zip >/dev/null 2>&1; then
  zip -r -X -q "$ZIP_PATH" manifest.json icons src \
    -x '*.DS_Store' -x '__MACOSX/*'
else
  echo "note: 'zip' CLI not found, falling back to python3 zipfile" >&2
  if ! command -v python3 >/dev/null 2>&1; then
    echo "error: neither 'zip' nor 'python3' is available" >&2
    exit 1
  fi
  python3 - "$ZIP_PATH" <<'PYEOF'
import os
import sys
import zipfile

zip_path = sys.argv[1]
root = os.getcwd()
entries = ["manifest.json", "icons", "src"]

with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as zf:
    for entry in entries:
        full = os.path.join(root, entry)
        if os.path.isfile(full):
            zf.write(full, entry)
            continue
        for dirpath, _dirnames, filenames in os.walk(full):
            for filename in filenames:
                if filename == ".DS_Store":
                    continue
                file_path = os.path.join(dirpath, filename)
                arcname = os.path.relpath(file_path, root)
                zf.write(file_path, arcname)
PYEOF
fi

echo "Built $ZIP_PATH"
