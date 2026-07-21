# Tests

Plain Node test scripts with no test framework or build step, matching the extension itself. Each `NN-*.mjs` file either exercises pure modules in a VM or loads the unpacked extension into headless Chromium through Playwright. `run.mjs` runs them all and prints a summary.

## Run locally

With Playwright installed globally or through npm:

```sh
npm install --no-save playwright axe-core
npx playwright install chromium
node tests/run.mjs
```

Or point at an existing Playwright and Chromium installation:

```sh
PLAYWRIGHT_MODULE=/path/to/node_modules/playwright/index.mjs \
CHROMIUM_BIN=/path/to/chromium \
node tests/run.mjs
```

`05-a11y.mjs` skips itself when `axe-core` is not installed. The remaining browser tests need Playwright and Chromium. The converter test also uses Python 3 to assemble a minimal DOCX fixture.

## What is covered

| Test | Covers |
| --- | --- |
| `01-boot` | Extension service worker, Settings, and legacy Claude popup load with zero console errors |
| `02-settings` | Every settings switch persists to `cuc:settings`; legacy `showNativeLimits` migration |
| `03-popup-render` | Claude popup renders seeded spend, limits, burn rate, insights, and accessible trend bars |
| `04-converter` | File conversion through the real background, offscreen document, and sandbox pipeline |
| `05-a11y` | Zero serious or critical axe-core violations on Settings and the Claude popup |
| `06-platforms` | Exact provider origins, Chat/Work/Codex detection, conversation IDs, and OpenAI usage normalization |
| `07-openai-manifest` | Provider isolation, exact host permissions, service worker composition, and script ordering |
| `08-openai-network` | Authenticated OpenAI event bridge, first-party filtering, and numeric-only usage snapshots |
| `09-openai-widget` | ChatGPT composer mounting, width, surface switching, dark mode, and Caveman preview |
| `10-popup-routing` | Active-provider popup routing and native OpenAI usage rendering |

CI runs the full suite on every push to `main` and every pull request through `.github/workflows/tests.yml`.
