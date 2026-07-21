// CI must not float to arbitrary future browser or accessibility-test releases.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { EXT_PATH, assert } from "./lib.mjs";

const workflow = readFileSync(join(EXT_PATH, ".github", "workflows", "tests.yml"), "utf8");

assert(/PLAYWRIGHT_VERSION:\s*["']?1\.61\.1["']?/.test(workflow), "Playwright is pinned to the verified version");
assert(/AXE_CORE_VERSION:\s*["']?4\.12\.1["']?/.test(workflow), "axe-core is pinned to the verified version");
assert(!/npm install --no-save playwright axe-core/.test(workflow), "CI never installs floating latest test dependencies");
assert(/actions\/cache@v4/.test(workflow), "Playwright browser binaries use the official cache action");
assert(/~\/\.cache\/ms-playwright/.test(workflow), "Playwright's browser cache directory is retained");
assert(/playwright-\$\{\{ runner\.os \}\}-\$\{\{ env\.PLAYWRIGHT_VERSION \}\}/.test(workflow), "browser cache key is tied to the pinned Playwright version");
assert(/playwright@\$\{PLAYWRIGHT_VERSION\}/.test(workflow), "the pinned Playwright package is installed explicitly");
assert(/axe-core@\$\{AXE_CORE_VERSION\}/.test(workflow), "the pinned axe-core package is installed explicitly");
assert(/npx playwright install --with-deps chromium/.test(workflow), "the matching Chromium build and system dependencies are installed");

console.log("14-ci-reproducibility PASS");
