#!/usr/bin/env bash
# Build the deterministic Chrome Web Store ZIP at dist/companion-<version>.zip.
# Only manifest.json, icons/, and src/ are placed at the archive root.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

for command in python3 node; do
  if ! command -v "$command" >/dev/null 2>&1; then
    echo "error: $command is required to build the release package" >&2
    exit 1
  fi
done

for required in \
  manifest.json \
  package.json \
  icons \
  src \
  src/models/lifejacket/onnx/model_quantized.onnx \
  src/models/lifejacket/provenance.json \
  src/models/lifejacket/SHA256SUMS \
  src/vendor/lifejacket/vendor-manifest.json \
  src/vendor/lifejacket/transformers.web.min.js \
  src/vendor/officeparser.browser.slim.iife.js \
  src/vendor/pdf.worker.min.mjs; do
  if [ ! -e "$required" ]; then
    echo "error: required release input is missing: $required" >&2
    exit 1
  fi
done

node tools/verify-lifejacket-assets.mjs

VERSION="$(python3 - <<'PY'
import json
from pathlib import Path
manifest = json.loads(Path('manifest.json').read_text(encoding='utf-8'))
package = json.loads(Path('package.json').read_text(encoding='utf-8'))
version = manifest.get('version')
if not isinstance(version, str) or not version:
    raise SystemExit('error: manifest version is missing')
if package.get('version') != version:
    raise SystemExit(f"error: package.json version {package.get('version')!r} does not match manifest {version!r}")
print(version)
PY
)"

DIST_DIR="$ROOT_DIR/dist"
ZIP_PATH="$DIST_DIR/companion-${VERSION}.zip"
INVENTORY_PATH="$DIST_DIR/companion-${VERSION}-inventory.json"
mkdir -p "$DIST_DIR"
rm -f "$ZIP_PATH" "$ZIP_PATH.sha256" "$INVENTORY_PATH"

STRAY="$(find src icons \
  \( -name '*.map' -o -name '.env*' -o -name '*.test.js' -o -name '*.spec.js' \
     -o -name '__tests__' -o -name '*.orig' -o -name '*.rej' -o -name '*.swp' \
     -o -name '*.tmp' -o -name '*.bak' -o -name '.DS_Store' -o -name '__MACOSX' \
     -o -path 'src/fonts/*.ttf' -o -name 'space-grotesk-latin.woff2' \) \
  -print 2>/dev/null || true)"
if [ -n "$STRAY" ]; then
  echo "error: development or forbidden assets found in the package set:" >&2
  echo "$STRAY" >&2
  exit 1
fi

REMOTE_CODE_PATTERN="(raw\\.githubusercontent\\.com|<script[^>]+src=['\"]https?://|importScripts\\(['\"]https?://|import\\(['\"]https?://)"
if grep -RInE \
  --exclude='transformers.web.min.js' \
  --include='*.js' --include='*.html' --include='manifest.json' \
  "$REMOTE_CODE_PATTERN" \
  manifest.json src >/tmp/companion-remote-code-scan.txt 2>/dev/null; then
  echo "error: possible remote-code or self-update reference found:" >&2
  cat /tmp/companion-remote-code-scan.txt >&2
  rm -f /tmp/companion-remote-code-scan.txt
  exit 1
fi
rm -f /tmp/companion-remote-code-scan.txt

python3 - "$ZIP_PATH" "$INVENTORY_PATH" <<'PY'
from __future__ import annotations

import hashlib
import json
import pathlib
import stat
import sys
import zipfile

zip_path = pathlib.Path(sys.argv[1])
inventory_path = pathlib.Path(sys.argv[2])
root = pathlib.Path.cwd()
fixed_timestamp = (2020, 1, 1, 0, 0, 0)

with (root / 'manifest.json').open(encoding='utf-8') as handle:
    manifest = json.load(handle)
if manifest.get('manifest_version') != 3:
    raise SystemExit('error: release package must use Manifest V3')
if manifest.get('name') != 'COMPANION':
    raise SystemExit('error: release package must use the COMPANION product name')

roots = [root / 'manifest.json', root / 'icons', root / 'src']
files: list[pathlib.Path] = []
for entry in roots:
    if entry.is_file():
        files.append(entry)
        continue
    for path in entry.rglob('*'):
        if path.is_symlink():
            raise SystemExit(f'error: symlink is not allowed in release package: {path}')
        if path.is_file():
            files.append(path)
files.sort(key=lambda path: path.relative_to(root).as_posix())
if not files:
    raise SystemExit('error: release package is empty')

inventory = []
zip_path.parent.mkdir(parents=True, exist_ok=True)
with zipfile.ZipFile(
    zip_path,
    mode='w',
    compression=zipfile.ZIP_DEFLATED,
    compresslevel=9,
    strict_timestamps=True,
) as archive:
    for path in files:
        relative = path.relative_to(root).as_posix()
        data = path.read_bytes()
        info = zipfile.ZipInfo(relative, date_time=fixed_timestamp)
        info.compress_type = zipfile.ZIP_DEFLATED
        info.create_system = 3
        info.external_attr = (stat.S_IFREG | 0o644) << 16
        archive.writestr(info, data, compress_type=zipfile.ZIP_DEFLATED, compresslevel=9)
        inventory.append({
            'path': relative,
            'bytes': len(data),
            'sha256': hashlib.sha256(data).hexdigest(),
        })

with zipfile.ZipFile(zip_path) as archive:
    names = archive.namelist()
    if names != sorted(names):
        raise SystemExit('error: archive entries are not sorted')
    if len(names) != len(set(names)):
        raise SystemExit('error: archive contains duplicate paths')
    allowed_roots = {'manifest.json', 'icons', 'src'}
    for name in names:
        top = name.split('/', 1)[0]
        if top not in allowed_roots:
            raise SystemExit(f'error: unexpected top-level archive path: {name}')
        lowered = name.lower()
        forbidden = (
            '/tests/' in f'/{lowered}',
            lowered.endswith('.map'),
            '/.env' in f'/{lowered}',
            lowered.endswith(('.orig', '.rej', '.swp', '.tmp', '.bak')),
            '__macosx' in lowered,
            lowered.endswith('.ttf'),
            lowered.endswith('space-grotesk-latin.woff2'),
        )
        if any(forbidden):
            raise SystemExit(f'error: forbidden release asset: {name}')
    required_names = {
        'manifest.json',
        'src/models/lifejacket/onnx/model_quantized.onnx',
        'src/models/lifejacket/provenance.json',
        'src/models/lifejacket/SHA256SUMS',
        'src/vendor/lifejacket/vendor-manifest.json',
        'src/vendor/lifejacket/transformers.web.min.js',
        'src/vendor/officeparser.browser.slim.iife.js',
        'src/vendor/pdf.worker.min.mjs',
    }
    missing = sorted(required_names.difference(names))
    if missing:
        raise SystemExit(f"error: archive is missing required release assets: {', '.join(missing)}")

inventory_document = {
    'schema': 1,
    'version': manifest['version'],
    'archive': zip_path.name,
    'fileCount': len(inventory),
    'uncompressedBytes': sum(item['bytes'] for item in inventory),
    'files': inventory,
}
inventory_path.write_text(json.dumps(inventory_document, indent=2, sort_keys=True) + '\n', encoding='utf-8')
print(f'Built {zip_path}')
print(f'Files: {len(files)}')
print(f'Bytes: {zip_path.stat().st_size}')
PY

if command -v sha256sum >/dev/null 2>&1; then
  (
    cd "$DIST_DIR"
    sha256sum "$(basename "$ZIP_PATH")" >"$(basename "$ZIP_PATH").sha256"
  )
else
  python3 - "$ZIP_PATH" <<'PY'
import hashlib
import pathlib
import sys
path = pathlib.Path(sys.argv[1])
digest = hashlib.sha256(path.read_bytes()).hexdigest()
path.with_suffix(path.suffix + '.sha256').write_text(f'{digest}  {path.name}\n', encoding='utf-8')
PY
fi

cat "$ZIP_PATH.sha256"
