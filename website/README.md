# COMPANION Website

The public website is a dependency-free static site. Source lives in `website/`; the build output is generated in `dist-site/` and should not be committed.

## Local build

```bash
npm run test:site
SITE_URL=http://localhost:4173 npm run build:site
python3 -m http.server 4173 --directory dist-site
```

Open `http://localhost:4173`.

## Cloudflare Pages

Create a Pages project from `zgbrenner/companion` with:

| Setting | Value |
| --- | --- |
| Framework preset | None |
| Build command | `npm run build:site` |
| Build output directory | `dist-site` |
| Root directory | `/` |
| Node version | 22 or newer |

Set these environment variables:

- `SITE_URL`: the production origin without a trailing slash, for example `https://companion.example`.
- `CHROME_WEB_STORE_URL`: optional. Leave it unset before launch. Once supplied, every store call to action becomes a live link during the next build.

The generated output includes Cloudflare `_headers` and `_redirects`, `robots.txt`, `sitemap.xml`, a web app manifest, local fonts, canonical extension screenshots, and a custom 404 page.

## Source boundaries

- Edit page copy and markup under `website/`.
- Edit shared styling in `website/assets/site.css`.
- Edit mobile navigation and screenshot tabs in `website/assets/site.js`.
- Do not copy extension screenshots, fonts, or the Orbit C mark into `website/`; `tools/build-site.mjs` copies the canonical repository assets and fails if a required asset is missing.
