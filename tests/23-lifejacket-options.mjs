import nodeAssert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchExtension, openPage, assert } from './lib.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
const wrapperHtml = fs.readFileSync(path.join(root, 'src/options-lifejacket.html'), 'utf8');
const wrapperJs = fs.readFileSync(path.join(root, 'src/options-lifejacket.js'), 'utf8');

nodeAssert.equal(manifest.options_page, 'src/options-lifejacket.html');
nodeAssert.match(wrapperHtml, /<iframe[^>]+src="options\.html"/);
nodeAssert.match(wrapperHtml, /lifejacket-settings\.js/);
nodeAssert.match(wrapperJs, /Lifejacket Mode/);
nodeAssert.doesNotMatch(wrapperHtml, /Caveman Mode/i);
for (const id of [
  'showLifejacketMode',
  'lifejacketMode',
  'lifejacketPromptCompression',
  'lifejacketReplyBrevity',
  'lifejacketFileConversion',
]) nodeAssert.match(wrapperJs, new RegExp(`["']${id}["']|${id}`), `Settings persists ${id}`);

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

  const { page, errors } = await openPage(context, extensionId, 'options-lifejacket.html');
  await page.waitForSelector('#settings-frame.ready');
  const settingsFrame = page.frameLocator('#settings-frame');
  await settingsFrame.locator('#lifejacketPromptCompression').waitFor();

  const state = Object.fromEntries(await Promise.all([
    'showLifejacketMode',
    'lifejacketMode',
    'lifejacketPromptCompression',
    'lifejacketReplyBrevity',
    'lifejacketFileConversion',
  ].map(async id => [id, await settingsFrame.locator(`#${id}`).getAttribute('aria-checked')])));
  assert(state.showLifejacketMode === 'true');
  assert(state.lifejacketMode === 'false');
  assert(state.lifejacketPromptCompression === 'true');
  assert(state.lifejacketReplyBrevity === 'true');
  assert(state.lifejacketFileConversion === 'true');
  assert(await settingsFrame.locator('#lifejacketPromptCompression').isDisabled(), 'children are disabled while the master is off');

  await settingsFrame.locator('#lifejacketMode').click();
  await settingsFrame.locator('#lifejacketPromptCompression').waitFor({ state: 'visible' });
  await page.waitForFunction(() => {
    const frame = document.querySelector('#settings-frame');
    return frame?.contentDocument?.querySelector('#lifejacketPromptCompression')?.disabled === false;
  });
  await settingsFrame.locator('#lifejacketPromptCompression').click();
  await page.waitForTimeout(350);
  const persisted = await worker.evaluate(async () => (await chrome.storage.local.get('cuc:settings'))['cuc:settings']);
  assert(persisted.lifejacketMode === true, 'master switch persists independently');
  assert(persisted.lifejacketPromptCompression === false, 'compression child switch persists independently');
  assert(persisted.lifejacketReplyBrevity === true, 'untouched reply preference is preserved');
  assert(persisted.lifejacketFileConversion === true, 'untouched file preference is preserved');

  await settingsFrame.locator('#reset-defaults').click();
  await page.waitForSelector('#settings-frame.ready');
  await page.waitForTimeout(350);
  const restored = await worker.evaluate(async () => (await chrome.storage.local.get('cuc:settings'))['cuc:settings']);
  assert(restored.lifejacketMode === false, 'restore defaults turns the master off');
  assert(restored.showLifejacketMode === true, 'restore defaults keeps the panel available');
  assert(restored.lifejacketPromptCompression === true, 'restore defaults enables compression child');
  assert(restored.lifejacketReplyBrevity === true, 'restore defaults enables reply child');
  assert(restored.lifejacketFileConversion === true, 'restore defaults enables file child');
  assert(errors.length === 0, `Settings errors: ${errors.join(' | ')}`);

  await page.close();
  console.log('PASS  Lifejacket Settings wrapper, controls, and persistence');
} finally {
  await context.close();
}
