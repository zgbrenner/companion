import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = fs.readFileSync(path.join(root, 'src/lifejacket-background.js'), 'utf8');
let listener = null;
let createCalls = 0;
let forwarded = null;
const chrome = {
  runtime: {
    id: 'test-extension',
    onMessage: { addListener(value) { listener = value; } },
    async sendMessage(message) {
      forwarded = message;
      return {
        ok: true,
        text: 'Review plan.',
        accepted: true,
        changed: true,
        savedPct: 35,
        model: 'MobileBERT LLMLingua-2 Q8',
        durationMs: 12,
        chunks: 1,
        modelInvoked: true,
      };
    },
  },
  offscreen: {
    async hasDocument() { return createCalls > 0; },
    async createDocument(options) {
      createCalls += 1;
      assert.equal(options.url, 'src/offscreen.html');
      assert.deepEqual(Array.from(options.reasons), ['WORKERS']);
      assert.match(options.justification, /Lifejacket/i);
    },
  },
};
const context = vm.createContext({ chrome, console, URL, setTimeout, clearTimeout, globalThis: null });
context.globalThis = context;
vm.runInContext(source, context, { filename: 'src/lifejacket-background.js' });
assert.equal(typeof listener, 'function', 'Lifejacket background registers one message listener');

async function send(message, sender) {
  let keepChannel;
  const response = await new Promise(resolve => {
    keepChannel = listener(message, sender, resolve);
  });
  return { keepChannel, response };
}

const validSender = {
  id: 'test-extension',
  frameId: 0,
  url: 'https://claude.ai/chat/abc',
  tab: { id: 7, url: 'https://claude.ai/chat/abc' },
};

{
  const { keepChannel, response } = await send({
    type: 'cuc:lifejacket-compress',
    text: 'Please carefully review the plan.',
    keepRatio: 0.65,
  }, validSender);
  assert.equal(keepChannel, true);
  assert.equal(response.ok, true);
  assert.equal(response.text, 'Review plan.');
  assert.equal(createCalls, 1);
  assert.equal(forwarded.type, 'cuc:lifejacket-compress-offscreen');
  assert.equal(forwarded.text, 'Please carefully review the plan.');
  assert.equal(forwarded.keepRatio, 0.65);
}

for (const [label, sender, message, expected] of [
  ['forged extension', { ...validSender, id: 'other' }, { type: 'cuc:lifejacket-compress', text: 'x', keepRatio: 0.65 }, /sender/i],
  ['subframe', { ...validSender, frameId: 2 }, { type: 'cuc:lifejacket-compress', text: 'x', keepRatio: 0.65 }, /frame/i],
  ['wrong origin', { ...validSender, url: 'https://evil.example/', tab: { url: 'https://evil.example/' } }, { type: 'cuc:lifejacket-compress', text: 'x', keepRatio: 0.65 }, /origin/i],
  ['empty text', validSender, { type: 'cuc:lifejacket-compress', text: '', keepRatio: 0.65 }, /text/i],
  ['oversize text', validSender, { type: 'cuc:lifejacket-compress', text: 'x'.repeat(120_001), keepRatio: 0.65 }, /size/i],
  ['bad ratio', validSender, { type: 'cuc:lifejacket-compress', text: 'x', keepRatio: 0.2 }, /ratio/i],
]) {
  const { keepChannel, response } = await send(message, sender);
  assert.equal(keepChannel, false, `${label} closes the message channel`);
  assert.equal(response.ok, false, `${label} is rejected`);
  assert.match(response.error, expected, label);
}

assert.equal(listener({ type: 'unrelated' }, validSender, () => {}), undefined);

const serviceWorker = fs.readFileSync(path.join(root, 'src/service-worker.js'), 'utf8');
assert.match(serviceWorker, /import ["']\.\/shared\.js["']/);
assert.match(serviceWorker, /import ["']\.\/lifejacket-settings\.js["']/);
assert.match(serviceWorker, /import ["']\.\/lifejacket-background\.js["']/);
assert.ok(serviceWorker.indexOf('lifejacket-settings.js') < serviceWorker.indexOf('background.js'));

const offscreen = fs.readFileSync(path.join(root, 'src/offscreen.html'), 'utf8');
assert.match(offscreen, /lifejacket-core\.js/);
assert.match(offscreen, /type="module" src="lifejacket-runtime\.js"/);
assert.ok(offscreen.indexOf('lifejacket-core.js') < offscreen.indexOf('lifejacket-runtime.js'));

assert.match(source, /45_000|45000/);
assert.match(source, /MAX_INPUT_CHARS\s*=\s*120_000/);
assert.match(source, /sender\.frameId/);
assert.match(source, /chatgpt\.com/);
assert.match(source, /claude\.ai/);

console.log('PASS  Lifejacket service-worker and offscreen routing');
