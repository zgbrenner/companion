import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
const source = fs.readFileSync(path.join(root, 'src/lifejacket-content.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'src/lifejacket.css'), 'utf8');

for (const contentScript of manifest.content_scripts.filter(entry => entry.world !== 'MAIN')) {
  const scripts = contentScript.js || [];
  assert.ok(scripts.includes('src/lifejacket-settings.js'), 'Lifejacket settings load on every supported provider');
  assert.ok(scripts.includes('src/lifejacket-core.js'), 'Lifejacket safety core loads on every supported provider');
  assert.ok(scripts.includes('src/lifejacket-content.js'), 'Lifejacket content UI loads on every supported provider');
  assert.ok(!scripts.includes('src/caveman.js'), 'retired Caveman runtime is not loaded');
  assert.ok(scripts.indexOf('src/lifejacket-settings.js') < scripts.findIndex(value => /(?:content|freshness-ui)\.js$/.test(value)));
  assert.ok(scripts.indexOf('src/lifejacket-core.js') < scripts.indexOf('src/lifejacket-content.js'));
}
assert.match(manifest.content_security_policy.extension_pages, /wasm-unsafe-eval/);
assert.ok(manifest.web_accessible_resources.every(entry => entry.resources.includes('src/lifejacket.css')));

assert.match(source, /Lifejacket Mode/);
for (const key of [
  'lifejacketMode',
  'lifejacketPromptCompression',
  'lifejacketReplyBrevity',
  'lifejacketFileConversion',
]) assert.match(source, new RegExp(key));
assert.match(source, /cuc:lifejacket-compress/);
assert.match(source, /cuc:convert-file/);
assert.match(source, /Send optimized/);
assert.match(source, /Send original/);
assert.match(source, /Cancel/);
assert.match(source, /MAX_FILE_BYTES\s*=\s*20\s*\*\s*1024\s*\*\s*1024/);
assert.match(source, /MAX_MARKDOWN_CHARS\s*=\s*800_000/);
assert.match(source, /stopImmediatePropagation/);
assert.match(source, /event\.isComposing/);
assert.match(source, /settings\.lifejacketPromptCompression/);
assert.match(source, /settings\.lifejacketReplyBrevity/);
assert.match(source, /settings\.lifejacketFileConversion/);
assert.doesNotMatch(source, /CAVEMAN|Caveman/);
assert.doesNotMatch(source, /https?:\/\//);
assert.match(css, /prefers-reduced-motion/);
assert.match(css, /:focus-visible/);

const context = vm.createContext({
  globalThis: null,
  console,
  URL,
  setTimeout,
  clearTimeout,
  requestAnimationFrame() {},
  document: {
    readyState: 'loading',
    documentElement: { className: '', getAttribute() { return null; } },
    addEventListener() {},
    querySelector() { return null; },
  },
  window: {
    addEventListener() {},
    matchMedia() { return { matches: false }; },
  },
  chrome: {
    runtime: { getURL(value) { return `chrome-extension://test/${value}`; } },
    storage: {
      local: { async get() { return {}; }, async set() {} },
      onChanged: { addListener() {} },
    },
  },
});
context.globalThis = context;
context.ClaudeUsageCompanion = {};
context.CompanionLifejacketSettings = {
  merge(value) { return value || {}; },
};
context.CompanionLifejacketCore = {
  REPLY_BREVITY_SUFFIX: 'suffix',
  appendReplySuffix(text, enabled) { return enabled ? `${text}\n\nsuffix` : text; },
};
vm.runInContext(source, context, { filename: 'src/lifejacket-content.js' });
const api = context.CompanionLifejacketContent;
assert.ok(api, 'Lifejacket content exports a small pure test surface');
assert.equal(api.shouldIntercept({ lifejacketMode: true, lifejacketPromptCompression: true, lifejacketReplyBrevity: false }), true);
assert.equal(api.shouldIntercept({ lifejacketMode: true, lifejacketPromptCompression: false, lifejacketReplyBrevity: true }), true);
assert.equal(api.shouldIntercept({ lifejacketMode: true, lifejacketPromptCompression: false, lifejacketReplyBrevity: false }), false);
assert.equal(api.shouldIntercept({ lifejacketMode: false, lifejacketPromptCompression: true, lifejacketReplyBrevity: true }), false);
assert.equal(api.composeOptimized('Prompt', true), 'Prompt\n\nsuffix');
assert.equal(api.composeOptimized('Prompt', false), 'Prompt');
assert.equal(api.providerFromHost('chatgpt.com'), 'ChatGPT');
assert.equal(api.providerFromHost('claude.ai'), 'Claude');

console.log('PASS  Lifejacket content, manifest, and control contract');
