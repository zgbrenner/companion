import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchExtension, assert } from './lib.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
const scriptGroups = manifest.content_scripts.filter(entry => entry.world !== 'MAIN');
assert(scriptGroups.length >= 2, 'Claude and ChatGPT isolated-world content scripts exist');
for (const group of scriptGroups) {
  assert(group.js.includes('src/lifejacket-settings.js'), 'Lifejacket settings load on every supported provider');
  assert(group.js.includes('src/lifejacket-core.js'), 'Lifejacket safety core loads on every supported provider');
  assert(group.js.includes('src/lifejacket-content.js'), 'Lifejacket UI loads on every supported provider');
  assert(!group.js.includes('src/caveman.js'), 'retired Caveman script is absent');
  assert(group.js.indexOf('src/lifejacket-settings.js') < group.js.indexOf('src/lifejacket-content.js'), 'Lifejacket settings load before its UI');
  assert(group.js.indexOf('src/lifejacket-core.js') < group.js.indexOf('src/lifejacket-content.js'), 'Lifejacket safety core loads before its UI');
}

const { context, worker } = await launchExtension();
try {
  const desired = {
    showWidget: true,
    lifejacketMode: true,
    showLifejacketMode: true,
    lifejacketPromptCompression: false,
    lifejacketReplyBrevity: true,
    lifejacketFileConversion: true,
    lifejacketKeepRatio: 0.65,
    cavemanMode: false,
    showCavemanMode: false,
  };
  await worker.evaluate(async settings => {
    await new Promise(resolve => setTimeout(resolve, 250));
    await chrome.storage.local.set({ 'cuc:settings': settings });
  }, desired);

  const body = `<!doctype html>
    <html lang="en">
      <head><meta charset="utf-8"><title>Lifejacket harness</title></head>
      <body style="margin:0;background:rgb(255,255,255);font-family:Arial,sans-serif">
        <input id="title-editor" aria-label="Rename conversation" value="Unrelated editable">
        <main style="min-height:90vh;display:flex;flex-direction:column;justify-content:flex-end;align-items:center">
          <section id="composer-shell" data-testid="composer-shell" style="width:680px;border:1px solid #ddd;border-radius:24px;background:white;padding:10px;box-sizing:border-box">
            <form data-testid="composer" style="display:flex;gap:8px">
              <div id="prompt-textarea" role="textbox" contenteditable="true" style="flex:1;min-height:42px"></div>
              <button type="submit" data-testid="send-button" aria-label="Send prompt">Send</button>
            </form>
          </section>
        </main>
        <script>
          window.sentPrompts = [];
          document.querySelector('form').addEventListener('submit', event => {
            event.preventDefault();
            window.sentPrompts.push(document.querySelector('#prompt-textarea').innerText);
          });
        </script>
      </body>
    </html>`;

  for (const origin of ['https://chatgpt.com/**', 'https://claude.ai/**']) {
    await context.route(origin, async route => {
      await route.fulfill({ status: 200, contentType: 'text/html', body });
    });
  }

  async function runSurface(url, label, sendOptimized) {
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(`pageerror: ${error}`));
    page.on('console', message => { if (message.type() === 'error') errors.push(`console: ${message.text()}`); });
    await page.goto(url);
    await page.waitForSelector('#cuc-lifejacket', { timeout: 10000 });

    const snapshot = await page.evaluate(() => {
      const host = document.querySelector('#cuc-lifejacket');
      const root = host?.shadowRoot;
      const checked = setting => root?.querySelector(`[data-lifejacket-setting="${setting}"]`)?.getAttribute('aria-checked');
      return {
        text: root?.textContent || '',
        master: checked('lifejacketMode'),
        compression: checked('lifejacketPromptCompression'),
        brevity: checked('lifejacketReplyBrevity'),
        files: checked('lifejacketFileConversion'),
        fileHidden: root?.querySelector('[data-lifejacket="file-control"]')?.hasAttribute('hidden'),
      };
    });
    assert(snapshot.text.includes('Lifejacket Mode'), `${label}: Lifejacket title renders`);
    assert(snapshot.text.includes('Compress prompts locally'), `${label}: compression child control renders`);
    assert(snapshot.text.includes('Ask for shorter replies'), `${label}: reply child control renders`);
    assert(snapshot.text.includes('Convert files to Markdown'), `${label}: file child control renders`);
    assert(snapshot.master === 'true', `${label}: master switch is on`);
    assert(snapshot.compression === 'false', `${label}: compression can be independently off`);
    assert(snapshot.brevity === 'true', `${label}: reply brevity can be independently on`);
    assert(snapshot.files === 'true', `${label}: file conversion can be independently on`);
    assert(snapshot.fileHidden === false, `${label}: file picker is visible when enabled`);

    const compressionSwitch = page.locator('#cuc-lifejacket').locator('[data-lifejacket-setting="lifejacketPromptCompression"]');
    await compressionSwitch.click();
    await page.waitForFunction(() => document.querySelector('#cuc-lifejacket')?.shadowRoot
      ?.querySelector('[data-lifejacket-setting="lifejacketPromptCompression"]')?.getAttribute('aria-checked') === 'true');
    const persistedOn = await worker.evaluate(async () => (await chrome.storage.local.get('cuc:settings'))['cuc:settings']?.lifejacketPromptCompression);
    assert(persistedOn === true, `${label}: compression child preference persists`);
    await compressionSwitch.click();
    await page.waitForFunction(() => document.querySelector('#cuc-lifejacket')?.shadowRoot
      ?.querySelector('[data-lifejacket-setting="lifejacketPromptCompression"]')?.getAttribute('aria-checked') === 'false');

    const original = 'Explain the deployment result and preserve the important caveats.';
    await page.locator('#prompt-textarea').fill(original);
    await page.locator('#prompt-textarea').press('Enter');
    await page.waitForFunction(() => {
      const dialog = document.querySelector('#cuc-lifejacket')?.shadowRoot?.querySelector('[data-lifejacket="preview-dialog"]');
      return dialog && !dialog.hasAttribute('hidden');
    }, undefined, { timeout: 10000 });
    const preview = await page.evaluate(() => {
      const root = document.querySelector('#cuc-lifejacket')?.shadowRoot;
      return {
        optimized: root?.querySelector('[data-lifejacket="preview-text"]')?.value || '',
        original: root?.querySelector('[data-lifejacket="original-text"]')?.textContent || '',
        status: root?.querySelector('[data-lifejacket="preview-status"]')?.textContent || '',
      };
    });
    const suffix = 'Reply briefly. Lead with the answer and keep every necessary fact, step, and caveat.';
    assert(preview.optimized.startsWith(original), `${label}: disabling compression preserves the prompt`);
    assert(preview.optimized.endsWith(suffix), `${label}: reply instruction is visibly appended at the end`);
    assert(preview.original.includes(original), `${label}: preview preserves the original`);

    if (sendOptimized) {
      await page.locator('#cuc-lifejacket').locator('[data-lifejacket-action="send-optimized"]').click();
      await page.waitForFunction(() => window.sentPrompts.length === 1);
      const sent = await page.evaluate(() => window.sentPrompts[0]);
      assert(sent.endsWith(suffix), `${label}: optimized send includes the brevity suffix`);
    } else {
      await page.locator('#cuc-lifejacket').locator('[data-lifejacket-action="cancel"]').click();
      await page.waitForFunction(() => document.querySelector('#cuc-lifejacket')?.shadowRoot
        ?.querySelector('[data-lifejacket="preview-dialog"]')?.hasAttribute('hidden'));
      assert(await page.locator('#prompt-textarea').innerText() === original, `${label}: cancel keeps the draft`);
    }

    await page.locator('#title-editor').press('Enter');
    await page.waitForTimeout(100);
    const unrelatedOpened = await page.evaluate(() => {
      const dialog = document.querySelector('#cuc-lifejacket')?.shadowRoot?.querySelector('[data-lifejacket="preview-dialog"]');
      return Boolean(dialog && !dialog.hasAttribute('hidden'));
    });
    assert(!unrelatedOpened, `${label}: unrelated editable fields are never intercepted`);

    await page.locator('#prompt-textarea').fill('Existing context');
    await page.locator('#cuc-lifejacket').locator('[data-lifejacket="file-input"]').setInputFiles({
      name: 'notes.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('Local file text'),
    });
    await page.waitForFunction(() => document.querySelector('#prompt-textarea')?.innerText.includes('Local file text'));
    const converted = await page.locator('#prompt-textarea').innerText();
    assert(converted.includes('Existing context') && converted.includes('Local file text'), `${label}: local text conversion appends Markdown without discarding the draft`);
    assert(errors.length === 0, `${label}: browser errors: ${errors.join(' | ')}`);
    await page.close();
  }

  await runSurface('https://chatgpt.com/c/lifejacket-test', 'ChatGPT', true);
  await runSurface('https://claude.ai/new', 'Claude', false);
  console.log('PASS  Lifejacket cross-provider controls, preview, send, and local file path');
} finally {
  await context.close();
}
