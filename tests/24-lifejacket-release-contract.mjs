import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');
const exists = relative => fs.existsSync(path.join(root, relative));

const manifest = JSON.parse(read('manifest.json'));
const pkg = JSON.parse(read('package.json'));
assert.equal(manifest.version, '1.3.0');
assert.equal(pkg.version, manifest.version, 'package and extension versions stay aligned');
assert.match(manifest.description, /Lifejacket/i);
assert.match(manifest.content_security_policy.extension_pages, /wasm-unsafe-eval/);
assert.match(manifest.content_security_policy.extension_pages, /worker-src\s+'self'\s+blob:/);
assert.doesNotMatch(JSON.stringify(manifest), /https:\/\/huggingface\.co|cdn\.jsdelivr\.net|unpkg\.com/);

const packageTool = read('tools/package-webstore.sh');
assert.match(packageTool, /verify-lifejacket-assets\.mjs/);
assert.match(packageTool, /src\/models\/lifejacket\/onnx\/model_quantized\.onnx/);
assert.match(packageTool, /src\/vendor\/lifejacket\/vendor-manifest\.json/);
assert.match(packageTool, /lifejacket-assets\.json/);
assert.match(packageTool, /fixed_timestamp|2020,\s*1,\s*1/);
assert.match(packageTool, /files\.sort/);
assert.doesNotMatch(packageTool, /version[^\n]*1\.2\.0|manifest\.get\(['"]version['"]\)\s*!=\s*['"]1\.2\.0/);

for (const file of [
  'RELEASE_NOTES_1.3.0.md',
  'docs/LIFEJACKET_MODE.md',
  'docs/SECURITY.md',
  'store/privacy-policy.md',
  'store/permission-justifications.md',
  'store/test-instructions.md',
]) {
  assert.ok(exists(file), `release documentation is present: ${file}`);
}

const lifejacketDocs = read('docs/LIFEJACKET_MODE.md');
assert.match(lifejacketDocs, /atjsh\/llmlingua-2-js-mobilebert-meetingbank/);
assert.match(lifejacketDocs, /900ed52628d7b153a276a220483d26d5f8dfe0f7/);
assert.match(lifejacketDocs, /Q8|INT8/i);
assert.match(lifejacketDocs, /never (?:downloads|fetched).*runtime|no runtime download/i);
assert.match(lifejacketDocs, /original prompt|send original/i);
assert.match(lifejacketDocs, /fail(?:s)? (?:closed|back)|fallback/i);

for (const file of ['README.md', 'src/options.html', 'store/listing.md', 'RELEASE_NOTES_1.3.0.md']) {
  const currentCopy = read(file);
  assert.doesNotMatch(currentCopy, /Caveman Mode/i, `current user-facing copy is renamed in ${file}`);
  assert.match(currentCopy, /Lifejacket Mode/i, `Lifejacket is documented in ${file}`);
}

const gitignore = read('.gitignore');
assert.match(gitignore, /src\/models\/lifejacket\/onnx/);
assert.match(gitignore, /src\/vendor\/lifejacket/);
assert.match(gitignore, /\.cache\/lifejacket/);

console.log('PASS  Lifejacket v1.3 release, privacy, and deterministic package contract');
