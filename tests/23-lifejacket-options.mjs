import nodeAssert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchExtension, openPage, assert } from './lib.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const optionsHtml = fs.readFileSync(path.join(root, 'src/options.html'), 'utf8');
const optionsJs = fs.readFileSync(path.join(root, 'src/options.js'), 'utf8');

nodeAssert.doesNotMatch(optionsHtml, /Caveman Mode/i, 'current Settings copy must use Lifejacket Mode');
nodeAssert.match(optionsHtml, /Lifejacket Mode/);
for (const id of [
  'showLifejacketMode',
  'lifejacketMode',
  'lifejacketPromptCompression',
  'lifejacketReplyBrevity',
  'lifejacketFileConversion',
]) {
  nodeAssert.match(optionsHtml, new RegExp(`id=["']${id}["']`), `Settings exposes ${id}`);
  nodeAssert.match(optionsJs, new RegExp(`["']${id}["']`), `Settings persists ${id}`);
}
nodeAssert.match(optionsHtml, /<script src="lifejacket-settings\.js"><\/script>/);
nodeAssert.ok(
  optionsHtml.indexOf('lifejacket-settings.js') < optionsHtml.indexOf('options.js'),
  'Lifejacket migration must load before the settings application',
);

const { context, worker, extensionId } = await launchExtension();
try {
  await worker.evaluate(async () => {
    await new Promise(resolve => setTimeout(resolve, 250));
    await chrome.storage.local.set({
      'cuc:settings': {
        lifejacketMode: false,
        showLifejacketMode: true,
        lifejacketPromptCompression: true,
        lifejacketReplyBrevity: true,
        lifejacketFileConversion: true,
      },
    });
  });

  const { page, errors } = await openPage(context, extensionId, 'options.html');
  await page.waitForSelector('#lifejacketPromptCompression');

  const state = await page.evaluate(() => Object.fromEntries([
    'showLifejacketMode',
    'lifejacketMode',
    'lifejacketPromptCompression',
    'lifejacketReplyBrevity',
    'lifejacketFileConversion',
  ].map(id => [id, document.getElementById(id)?.getAttribute('aria-checked')])));
  assert(state.showLifejacketMode === 'true');
  assert(state.lifejacketMode === 'false');
  assert(state.lifejacketPromptCompression === 'true');
  assert(state.lifejacketReplyBrevity === 'true');
  assert(state.lifejacketFileConversion === 'true');

  await page.locator('#lifejacketMode').click();
  await page.locator('#lifejacketPromptCompression').click();
  await page.waitForTimeout(350);
  const persisted = await worker.evaluate(async () => (await chrome.storage.local.get('cuc:settings'))['cuc:settings']);
  assert(persisted.lifejacketMode === true, 'master switch persists independently');
  assert(persisted.lifejacketPromptCompression === false, 'compression child switch persists independently');
  assert(persisted.lifejacketReplyBrevity === true, 'untouched reply preference is preserved');
  assert(persisted.lifejacketFileConversion === true, 'untouched file preference is preserved');

  await page.locator('#reset-defaults').click();
  await page.waitForTimeout(350);
  const restored = await worker.evaluate(async () => (await chrome.storage.local.get('cuc:settings'))['cuc:settings']);
  assert(restored.lifejacketMode === false, 'restore defaults turns the master off');
  assert(restored.showLifejacketMode === true, 'restore defaults keeps the panel available');
  assert(restored.lifejacketPromptCompression === true, 'restore defaults enables compression child');
  assert(restored.lifejacketReplyBrevity === true, 'restore defaults enables reply child');
  assert(restored.lifejacketFileConversion === true, 'restore defaults enables file child');
  assert(errors.length === 0, `Settings errors: ${errors.join(' | ')}`);

  await page.close();
  console.log('PASS  Lifejacket Settings controls and persistence');
} finally {
  await context.close();
}
