import assert from 'node:assert/strict';
import { access, readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const website = path.join(root, 'website');
const pages = ['index.html', 'privacy/index.html', 'terms/index.html', 'security/index.html', 'support/index.html', 'accessibility/index.html', '404.html'];

for (const page of pages) await access(path.join(website, page));

const home = await readFile(path.join(website, 'index.html'), 'utf8');
for (const phrase of [
  'Know your limits. Waste fewer tokens. Keep your work private.',
  'Chrome Web Store',
  'coming soon',
  'Native numbers or nothing',
  'Lifejacket Mode',
  'Completely local',
  'Open source',
  'No COMPANION account',
  'No analytics or telemetry',
  'Claude and ChatGPT'
]) assert.match(home, new RegExp(phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'));

for (const asset of ['01-overview.png', '02-claude-usage.png', '03-chatgpt-work-codex.png', '04-settings-privacy.png']) {
  assert.match(home, new RegExp(`/assets/${asset.replace('.', '\\.')}`));
}

for (const route of ['/privacy/', '/terms/', '/security/', '/support/', '/accessibility/']) {
  assert.match(home, new RegExp(`href="${route.replaceAll('/', '\\/')}"`));
}

assert.doesNotMatch(home, /fonts\.googleapis|googletagmanager|google-analytics|segment\.com|plausible\.io/i);
assert.match(await readFile(path.join(website, 'privacy', 'index.html'), 'utf8'), /does not sell.*personal information/i);
assert.match(await readFile(path.join(website, 'terms', 'index.html'), 'utf8'), /provided.*as is/i);
assert.match(await readFile(path.join(website, 'security', 'index.html'), 'utf8'), /no developer backend/i);
assert.match(await readFile(path.join(website, 'support', 'index.html'), 'utf8'), /GitHub Issues/i);
assert.match(await readFile(path.join(website, 'accessibility', 'index.html'), 'utf8'), /WCAG 2\.2 AA/i);

const allSource = (await Promise.all(pages.map((page) => readFile(path.join(website, page), 'utf8')))).join('\n');
assert.doesNotMatch(allSource, /target="_blank"(?![^>]*rel="noopener noreferrer")/i);

const assetFiles = await readdir(path.join(website, 'assets'));
assert.ok(assetFiles.includes('site.css'));
assert.ok(assetFiles.includes('site.js'));

console.log('site content contract: pass');
