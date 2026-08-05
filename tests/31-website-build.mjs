import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, access } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const root = await mkdtemp(path.join(os.tmpdir(), 'companion-site-test-'));
const outDir = path.join(root, 'dist-site');

await mkdir(path.join(root, 'website', 'assets'), { recursive: true });
await mkdir(path.join(root, 'website', 'privacy'), { recursive: true });
await mkdir(path.join(root, 'icons'), { recursive: true });
await mkdir(path.join(root, 'src', 'fonts'), { recursive: true });
await mkdir(path.join(root, 'store', 'screenshots'), { recursive: true });

await writeFile(path.join(root, 'website', 'index.html'), '<link rel="canonical" href="{{SITE_URL}}/"><img src="/assets/orbit-c.svg"><a data-store-link href="{{STORE_URL}}">Chrome Web Store, coming soon</a>');
await writeFile(path.join(root, 'website', 'privacy', 'index.html'), '<link rel="canonical" href="{{SITE_URL}}/privacy/">');
await writeFile(path.join(root, 'website', 'robots.txt'), 'Sitemap: {{SITE_URL}}/sitemap.xml\n');
await writeFile(path.join(root, 'website', 'assets', 'site.css'), 'body{}');
await writeFile(path.join(root, 'icons', 'orbit-c.svg'), '<svg/>');
await writeFile(path.join(root, 'icons', 'icon128.png'), 'icon');
await writeFile(path.join(root, 'src', 'fonts', 'atkinson-hyperlegible-next-variable.woff2'), 'font-a');
await writeFile(path.join(root, 'src', 'fonts', 'league-spartan-bold.woff2'), 'font-b');
await writeFile(path.join(root, 'store', 'screenshots', '01-widget-light.png'), 'shot');

for (const file of ['icon16.png', 'icon32.png', 'icon48.png']) {
  await writeFile(path.join(root, 'icons', file), 'icon');
}
for (const file of ['02-popup-light.png', '03-settings-light.png', '04-widget-dark.png', '05-popup-dark.png']) {
  await writeFile(path.join(root, 'store', 'screenshots', file), 'shot');
}
await writeFile(path.join(root, 'store', 'promo-tile-440x280.png'), 'promo');
await mkdir(outDir, { recursive: true });
await writeFile(path.join(outDir, 'stale.txt'), 'remove me');

const { buildSite } = await import('../tools/build-site.mjs');
const result = await buildSite({ rootDir: root, outDir, siteUrl: 'https://companion.example' });

assert.equal(result.siteUrl, 'https://companion.example');
assert.ok(result.filesWritten >= 10);
const builtHome = await readFile(path.join(outDir, 'index.html'), 'utf8');
assert.match(builtHome, /https:\/\/companion\.example\//);
assert.match(builtHome, /data-store-unavailable/);
assert.match(builtHome, /href="#"/);
assert.doesNotMatch(builtHome, /\{\{STORE_URL\}\}/);
assert.match(await readFile(path.join(outDir, 'privacy', 'index.html'), 'utf8'), /https:\/\/companion\.example\/privacy\//);
assert.equal(await readFile(path.join(outDir, 'robots.txt'), 'utf8'), 'Sitemap: https://companion.example/sitemap.xml\n');
assert.match(await readFile(path.join(outDir, 'sitemap.xml'), 'utf8'), /<loc>https:\/\/companion\.example\/privacy\/<\/loc>/);
await access(path.join(outDir, 'assets', 'orbit-c.svg'));
await access(path.join(outDir, 'assets', 'icon128.png'));
await access(path.join(outDir, 'assets', 'atkinson-hyperlegible-next-variable.woff2'));
await access(path.join(outDir, 'assets', 'league-spartan-bold.woff2'));
await access(path.join(outDir, 'assets', '01-widget-light.png'));
await assert.rejects(access(path.join(outDir, 'stale.txt')));

const allText = [
  await readFile(path.join(outDir, 'index.html'), 'utf8'),
  await readFile(path.join(outDir, 'privacy', 'index.html'), 'utf8'),
  await readFile(path.join(outDir, 'robots.txt'), 'utf8'),
  await readFile(path.join(outDir, 'sitemap.xml'), 'utf8')
].join('\n');
assert.doesNotMatch(allText, /\{\{SITE_URL\}\}/);

const liveOutDir = path.join(root, 'dist-site-live');
await buildSite({
  rootDir: root,
  outDir: liveOutDir,
  siteUrl: 'https://companion.example',
  storeUrl: 'https://chromewebstore.google.com/detail/companion/example'
});
const liveHome = await readFile(path.join(liveOutDir, 'index.html'), 'utf8');
assert.match(liveHome, /href="https:\/\/chromewebstore\.google\.com\/detail\/companion\/example"/);
assert.doesNotMatch(liveHome, /data-store-unavailable|\{\{STORE_URL\}\}/);

const brokenRoot = await mkdtemp(path.join(os.tmpdir(), 'companion-site-missing-'));
await mkdir(path.join(brokenRoot, 'website'), { recursive: true });
await writeFile(path.join(brokenRoot, 'website', 'index.html'), '<p>test</p>');
await assert.rejects(
  buildSite({ rootDir: brokenRoot, outDir: path.join(brokenRoot, 'dist-site'), siteUrl: 'https://companion.example' }),
  /Required website asset missing/
);

console.log('site build contract: pass');
