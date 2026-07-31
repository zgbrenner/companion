import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchExtension, assert } from './lib.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
for (const group of manifest.content_scripts.filter(entry => entry.world !== 'MAIN')) {
  assert(group.js.includes('src/lifejacket-settings.js'));
  assert(group.js.includes('src/lifejacket-core.js'));
  assert(group.js.includes('src/lifejacket-content.js'));
  assert(!group.js.includes('src/caveman.js'));
  assert(group.js.indexOf('src/lifejacket-core.js') < group.js.indexOf('src/lifejacket-content.js'));
}

const { context, worker } = await launchExtension();
try {
  await worker.evaluate(async () => {
    await chrome.storage.local.set({ 'cuc:settings': {
      showWidget: true,
      lifejacketMode: true,
      showLifejacketMode: true,
      lifejacketPromptCompression: false,
      lifejacketReplyBrevity: true,
      lifejacketFileConversion: true,
      lifejacketKeepRatio: 0.65,
    } });
  });

  const body = `<!doctype html><html lang="en"><body>
    <input id="title-editor" value="Rename">
    <main style="min-height:90vh;display:flex;align-items:flex-end;justify-content:center">
      <section data-testid="composer-shell" style="width:680px;border:1px solid #ddd;border-radius:24px;padding:10px">
        <form data-testid="composer"><div id="prompt-textarea" role="textbox" contenteditable="true"></div><button type="submit" aria-label="Send prompt">Send</button></form>
      </section>
    </main></body></html>`;
  for (const pattern of ['https://chatgpt.com/**', 'https://claude.ai/**']) {
    await context.route(pattern, route => route.fulfill({ status: 200, contentType: 'text/html', body }));
  }

  async function verifySurface(url, label, sendOptimized) {
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(String(error)));
    await page.goto(url);
    await page.evaluate(() => {
      window.sentPrompts = [];
      document.querySelector('form').addEventListener('submit', event => {
        event.preventDefault();
        window.sentPrompts.push(document.querySelector('#prompt-textarea').innerText);
      });
    });
    await page.waitForSelector('#companion-lifejacket');

    const state = await page.evaluate(() => {
      const root = document.querySelector('#companion-lifejacket').shadowRoot;
      const checked = key => root.querySelector(`[data-lj-setting="${key}"]`)?.getAttribute('aria-checked');
      return {
        text: root.textContent,
        master: checked('lifejacketMode'),
        compression: checked('lifejacketPromptCompression'),
        brevity: checked('lifejacketReplyBrevity'),
        files: checked('lifejacketFileConversion'),
        fileHidden: root.querySelector('[data-lj="file"]')?.hidden,
      };
    });
    assert(state.text.includes('Lifejacket Mode'), `${label}: title`);
    assert(state.text.includes('Compress prompts'), `${label}: compressor control`);
    assert(state.text.includes('Shorter replies'), `${label}: brevity control`);
    assert(state.text.includes('Files to Markdown'), `${label}: file control`);
    assert(state.master === 'true' && state.compression === 'false' && state.brevity === 'true' && state.files === 'true');
    assert(state.fileHidden === false, `${label}: file control visible`);

    const compression = page.locator('#companion-lifejacket').locator('[data-lj-setting="lifejacketPromptCompression"]');
    await compression.click();
    await page.waitForFunction(() => document.querySelector('#companion-lifejacket').shadowRoot
      .querySelector('[data-lj-setting="lifejacketPromptCompression"]').getAttribute('aria-checked') === 'true');
    assert(await worker.evaluate(async () => (await chrome.storage.local.get('cuc:settings'))['cuc:settings'].lifejacketPromptCompression));
    await compression.click();

    const original = 'Explain the result and preserve important caveats.';
    const suffix = 'Reply briefly. Lead with the answer and keep every necessary fact, step, and caveat.';
    await page.locator('#prompt-textarea').fill(original);
    await page.locator('#prompt-textarea').press('Enter');
    await page.waitForFunction(expected => {
      const root = document.querySelector('#companion-lifejacket').shadowRoot;
      return !root.querySelector('[data-lj="overlay"]').hidden
        && root.querySelector('[data-lj="optimized"]').value.endsWith(expected)
        && !root.querySelector('[data-lj-action="send-optimized"]').disabled;
    }, suffix);

    const preview = await page.evaluate(() => {
      const root = document.querySelector('#companion-lifejacket').shadowRoot;
      return {
        optimized: root.querySelector('[data-lj="optimized"]').value,
        original: root.querySelector('[data-lj="original"]').textContent,
      };
    });
    assert(preview.optimized.startsWith(original) && preview.optimized.endsWith(suffix));
    assert(preview.original.includes(original));

    if (sendOptimized) {
      await page.locator('#companion-lifejacket').locator('[data-lj-action="send-optimized"]').click();
      await page.waitForFunction(() => window.sentPrompts.length === 1);
      assert((await page.evaluate(() => window.sentPrompts[0])).endsWith(suffix));
    } else {
      await page.locator('#companion-lifejacket').locator('[data-lj-action="cancel"]').click();
      assert(await page.locator('#prompt-textarea').innerText() === original);
    }

    await page.locator('#title-editor').press('Enter');
    await page.waitForTimeout(75);
    assert(await page.evaluate(() => document.querySelector('#companion-lifejacket').shadowRoot.querySelector('[data-lj="overlay"]').hidden));

    await page.locator('#prompt-textarea').fill('Existing context');
    await page.locator('#companion-lifejacket').locator('[data-lj="file-input"]').setInputFiles({
      name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('Local file text'),
    });
    await page.waitForFunction(() => document.querySelector('#prompt-textarea').innerText.includes('Local file text'));
    assert((await page.locator('#prompt-textarea').innerText()).includes('Existing context'));
    assert(errors.length === 0, `${label}: ${errors.join(' | ')}`);
    await page.close();
  }

  await verifySurface('https://chatgpt.com/c/lifejacket-test', 'ChatGPT', true);
  await verifySurface('https://claude.ai/new', 'Claude', false);
  console.log('PASS  Lifejacket cross-provider browser behavior');
} finally {
  await context.close();
}
