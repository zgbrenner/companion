# Tests

Plain-node test scripts — no test framework, no build step, matching the
extension itself. Each `NN-*.mjs` file loads the unpacked extension into
headless Chromium via Playwright and exits non-zero on failure;
`run.mjs` runs them all and prints a summary.

## Run locally

With Playwright installed globally or via npm:

```sh
npm install --no-save playwright axe-core
npx playwright install chromium
node tests/run.mjs
```

Or point at an existing Playwright/Chromium install:

```sh
PLAYWRIGHT_MODULE=/path/to/node_modules/playwright/index.mjs \
CHROMIUM_BIN=/path/to/chromium \
node tests/run.mjs
```

`05-a11y.mjs` skips itself when `axe-core` isn't installed; everything else
has zero dependencies beyond Playwright and python3 (used to assemble a
minimal DOCX fixture).

## What's covered

| Test | Covers |
|---|---|
| `01-boot` | Extension loads; service worker starts; options + popup open with zero console errors |
| `02-settings` | Every settings switch persists to `cuc:settings`; legacy `showNativeLimits` migration |
| `03-popup-render` | Popup renders seeded usage state: spend figures, limit rows, burn rate, insights, accessible trend bars |
| `04-converter` | Caveman file conversion end-to-end through the real background → offscreen → sandbox pipeline (DOCX, CSV, empty-file error path) |
| `05-a11y` | axe-core: zero serious/critical violations on options + popup |

CI runs the full suite on every push and pull request
(`.github/workflows/tests.yml`).
