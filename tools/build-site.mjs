import { cp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DEFAULT_SITE_URL = 'https://companion.pages.dev';
const ROUTES = ['/', '/privacy/', '/terms/', '/security/', '/support/', '/accessibility/'];

function normalizeSiteUrl(value) {
  const url = new URL(value || DEFAULT_SITE_URL);
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error('SITE_URL must use http or https');
  }
  return url.toString().replace(/\/$/, '');
}

function normalizeOptionalUrl(value, label) {
  if (!value) return null;
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error(`${label} must use http or https`);
  }
  return url.toString();
}

async function listFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await listFiles(absolute));
    else files.push(absolute);
  }
  return files;
}

async function replaceTokens(directory, siteUrl) {
  const files = await listFiles(directory);
  const textExtensions = new Set(['.html', '.txt', '.xml', '.webmanifest', '.json']);
  for (const file of files) {
    if (!textExtensions.has(path.extname(file))) continue;
    const original = await readFile(file, 'utf8');
    const next = original.replaceAll('{{SITE_URL}}', siteUrl);
    if (next !== original) await writeFile(file, next);
  }
}

async function finalizeStoreLinks(directory, storeUrl) {
  const files = (await listFiles(directory)).filter((file) => path.extname(file) === '.html');
  for (const file of files) {
    const original = await readFile(file, 'utf8');
    let next = original.replaceAll('{{STORE_URL}}', storeUrl || '#');
    if (storeUrl) {
      next = next
        .replaceAll('<small data-store-soon>soon</small>', '')
        .replaceAll('Chrome Web Store, coming soon', 'Get COMPANION on the Chrome Web Store')
        .replaceAll('Store launch coming soon', 'Open Chrome Web Store');
    } else {
      next = next.replace(/<a([^>]*\bdata-store-link\b[^>]*)>/g, (match, attributes) => {
        if (/\baria-disabled=/.test(attributes)) return match;
        return `<a${attributes} aria-disabled="true" data-store-unavailable>`;
      });
    }
    if (next !== original) await writeFile(file, next);
  }
}

async function copyRequired(source, destination) {
  try {
    const info = await stat(source);
    if (!info.isFile()) throw new Error(`Required website asset missing: ${source}`);
    await mkdir(path.dirname(destination), { recursive: true });
    await cp(source, destination);
    return true;
  } catch (error) {
    if (error?.code === 'ENOENT') throw new Error(`Required website asset missing: ${source}`);
    throw error;
  }
}

export async function buildSite({
  rootDir = process.cwd(),
  outDir = path.join(rootDir, 'dist-site'),
  siteUrl = process.env.SITE_URL || DEFAULT_SITE_URL,
  storeUrl = process.env.CHROME_WEB_STORE_URL || ''
} = {}) {
  const normalizedSiteUrl = normalizeSiteUrl(siteUrl);
  const normalizedStoreUrl = normalizeOptionalUrl(storeUrl, 'CHROME_WEB_STORE_URL');
  const websiteDir = path.join(rootDir, 'website');

  await rm(outDir, { recursive: true, force: true });
  await mkdir(outDir, { recursive: true });
  await cp(websiteDir, outDir, { recursive: true });

  const assets = [
    ['icons/orbit-c.svg', 'assets/orbit-c.svg'],
    ['icons/icon16.png', 'assets/icon16.png'],
    ['icons/icon32.png', 'assets/icon32.png'],
    ['icons/icon48.png', 'assets/icon48.png'],
    ['icons/icon128.png', 'assets/icon128.png'],
    ['src/fonts/atkinson-hyperlegible-next-variable.woff2', 'assets/atkinson-hyperlegible-next-variable.woff2'],
    ['src/fonts/league-spartan-bold.woff2', 'assets/league-spartan-bold.woff2'],
    ['store/screenshots/01-overview.png', 'assets/01-overview.png'],
    ['store/screenshots/02-claude-usage.png', 'assets/02-claude-usage.png'],
    ['store/screenshots/03-chatgpt-work-codex.png', 'assets/03-chatgpt-work-codex.png'],
    ['store/screenshots/04-settings-privacy.png', 'assets/04-settings-privacy.png'],
    ['store/screenshots/05-local-efficiency-tools.png', 'assets/05-local-efficiency-tools.png'],
    ['store/promo-tile-440x280.png', 'assets/promo-tile-440x280.png']
  ];

  for (const [source, destination] of assets) {
    await copyRequired(path.join(rootDir, source), path.join(outDir, destination));
  }

  const sitemap = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/sitemap/0.9">\n${ROUTES.map((route) => `  <url><loc>${normalizedSiteUrl}${route}</loc></url>`).join('\n')}\n</urlset>\n`;
  await writeFile(path.join(outDir, 'sitemap.xml'), sitemap);
  await replaceTokens(outDir, normalizedSiteUrl);
  await finalizeStoreLinks(outDir, normalizedStoreUrl);

  const filesWritten = (await listFiles(outDir)).length;
  return { outDir, siteUrl: normalizedSiteUrl, storeUrl: normalizedStoreUrl, filesWritten };
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) {
  const result = await buildSite();
  console.log(`Built ${result.filesWritten} files in ${result.outDir}`);
}
