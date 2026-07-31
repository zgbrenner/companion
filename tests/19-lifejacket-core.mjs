import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function runScript(file, context) {
  const source = fs.readFileSync(path.join(root, file), 'utf8');
  vm.runInContext(source, context, { filename: file });
}

const context = vm.createContext({
  console,
  URL,
  TextEncoder,
  globalThis: null,
});
context.globalThis = context;
context.ClaudeUsageCompanion = {
  DEFAULT_SETTINGS: {
    cavemanMode: false,
    showCavemanMode: true,
    showWidget: true,
  },
  mergeSettings(stored) {
    return {
      cavemanMode: false,
      showCavemanMode: true,
      showWidget: true,
      ...(stored || {}),
    };
  },
};

runScript('src/lifejacket-settings.js', context);
runScript('src/lifejacket-core.js', context);

const settingsApi = context.CompanionLifejacketSettings;
const core = context.CompanionLifejacketCore;
assert.ok(settingsApi, 'Lifejacket settings API is exported');
assert.ok(core, 'Lifejacket core API is exported');

{
  const migrated = settingsApi.merge({ cavemanMode: true, showCavemanMode: false });
  assert.equal(migrated.lifejacketMode, true, 'legacy enabled Caveman migrates to enabled Lifejacket');
  assert.equal(migrated.showLifejacketMode, false, 'legacy visibility migrates');
  assert.equal(migrated.lifejacketPromptCompression, true);
  assert.equal(migrated.lifejacketReplyBrevity, true);
  assert.equal(migrated.lifejacketFileConversion, true);
  assert.equal(migrated.lifejacketKeepRatio, 0.65);
  assert.equal(migrated.cavemanMode, false, 'legacy runtime is forced off');
  assert.equal(migrated.showCavemanMode, false, 'legacy UI is forced off');
}

{
  const explicit = settingsApi.merge({
    cavemanMode: true,
    lifejacketMode: false,
    showLifejacketMode: true,
    lifejacketPromptCompression: false,
    lifejacketReplyBrevity: true,
    lifejacketFileConversion: false,
    lifejacketKeepRatio: 0.7,
  });
  assert.equal(explicit.lifejacketMode, false, 'new master value wins over legacy value');
  assert.equal(explicit.lifejacketPromptCompression, false);
  assert.equal(explicit.lifejacketReplyBrevity, true);
  assert.equal(explicit.lifejacketFileConversion, false);
  assert.equal(explicit.lifejacketKeepRatio, 0.7);
}

{
  const clampedLow = settingsApi.merge({ lifejacketKeepRatio: 0.01 });
  const clampedHigh = settingsApi.merge({ lifejacketKeepRatio: 0.99 });
  assert.equal(clampedLow.lifejacketKeepRatio, 0.4);
  assert.equal(clampedHigh.lifejacketKeepRatio, 0.85);
}

const original = [
  'Please review the deployment plan for 2026-08-14.',
  'Email dev@example.com and use https://example.com/run?id=42.',
  'Do not change `npm run release` or this block:',
  '```js',
  'const buildId = "release-42";',
  '```',
  'Return the safest concise recommendation.',
].join('\n');

const protectedPrompt = core.protectPrompt(original);
assert.equal(protectedPrompt.original, original);
assert.ok(protectedPrompt.segments.some(segment => segment.type === 'protected' && segment.text.includes('2026-08-14')));
assert.ok(protectedPrompt.segments.some(segment => segment.type === 'protected' && segment.text.includes('dev@example.com')));
assert.ok(protectedPrompt.segments.some(segment => segment.type === 'protected' && segment.text.includes('https://example.com/run?id=42')));
assert.ok(protectedPrompt.segments.some(segment => segment.type === 'protected' && segment.text.includes('npm run release')));
assert.ok(protectedPrompt.segments.some(segment => segment.type === 'protected' && segment.text.includes('const buildId')));

{
  const missingProtected = core.finalizeCompression({
    original,
    candidate: 'Review deployment plan. Return recommendation.',
    protectedSpans: protectedPrompt.protectedSpans,
  });
  assert.equal(missingProtected.accepted, false);
  assert.equal(missingProtected.text, original);
  assert.match(missingProtected.warning, /protected/i);
}

{
  const reordered = core.finalizeCompression({
    original,
    candidate: `${protectedPrompt.protectedSpans.slice().reverse().join(' ')} Return recommendation.`,
    protectedSpans: protectedPrompt.protectedSpans,
  });
  assert.equal(reordered.accepted, false);
  assert.equal(reordered.text, original);
  assert.match(reordered.warning, /order/i);
}

{
  const gutted = core.finalizeCompression({
    original,
    candidate: protectedPrompt.protectedSpans.join(' '),
    protectedSpans: protectedPrompt.protectedSpans,
  });
  assert.equal(gutted.accepted, false);
  assert.equal(gutted.text, original);
  assert.match(gutted.warning, /too much/i);
}

{
  const candidate = original.replace('Please review the deployment plan for ', 'Review deployment plan for ')
    .replace('Return the safest concise recommendation.', 'Return safest recommendation.');
  const accepted = core.finalizeCompression({
    original,
    candidate,
    protectedSpans: protectedPrompt.protectedSpans,
  });
  assert.equal(accepted.accepted, true);
  assert.equal(accepted.changed, true);
  assert.equal(accepted.text, candidate);
  assert.ok(accepted.savedPct > 0);
}

{
  const suffix = core.REPLY_BREVITY_SUFFIX;
  const withSuffix = core.appendReplySuffix('Explain the result.', true);
  assert.ok(withSuffix.endsWith(suffix), 'brevity instruction is at the end');
  assert.equal(withSuffix.match(new RegExp(suffix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')).length, 1);
  assert.equal(core.appendReplySuffix(withSuffix, true), withSuffix, 'suffix is idempotent');
  assert.equal(core.appendReplySuffix('Explain the result.', false), 'Explain the result.');
}

console.log('PASS  Lifejacket settings migration and pure safety core');
