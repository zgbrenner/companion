import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');

const vendorTool = read('tools/vendor-lifejacket-runtime.mjs');
assert.match(
  vendorTool,
  /src['"],\s*['"]vendor['"],\s*['"]lifejacket['"]|src[^\n]+vendor[^\n]+lifejacket/,
  'Lifejacket ML dependencies must be isolated under src/vendor/lifejacket',
);
assert.doesNotMatch(
  vendorTool,
  /rmSync\(\s*(?:outputRoot|path\.join\([^)]*['"]vendor['"][^)]*\))\s*,\s*\{[^}]*recursive:\s*true/,
  'the build must never recursively delete the shared src/vendor directory',
);

const runtime = read('src/lifejacket-runtime.js');
assert.match(runtime, /\.\/vendor\/lifejacket\/transformers\.web\.min\.js/);
assert.match(runtime, /src\/vendor\/lifejacket\/ort\//);

const sandbox = read('src/sandbox.html');
const offscreen = read('src/offscreen.js');
assert.match(sandbox, /vendor\/officeparser\.browser\.slim\.iife\.js/);
assert.match(offscreen, /vendor\/pdf\.worker\.min\.mjs/);

console.log('PASS  Lifejacket vendoring cannot delete file-conversion dependencies');
