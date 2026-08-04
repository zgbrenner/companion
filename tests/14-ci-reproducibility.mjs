// CI must not float to arbitrary future browser or accessibility-test releases.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { EXT_PATH, assert } from "./lib.mjs";

const workflow = readFileSync(join(EXT_PATH, ".github", "workflows", "tests.yml"), "utf8");
const action = readFileSync(join(EXT_PATH, ".github", "actions", "build-extension", "action.yml"), "utf8");
const packageJson = JSON.parse(readFileSync(join(EXT_PATH, "package.json"), "utf8"));
const lockJson = JSON.parse(readFileSync(join(EXT_PATH, "package-lock.json"), "utf8"));
const lockedDevDependencies = lockJson.packages?.[""].devDependencies || {};

assert(packageJson.devDependencies?.playwright === "1.61.1", "Playwright is pinned in package.json");
assert(packageJson.devDependencies?.["axe-core"] === "4.12.1", "axe-core is pinned in package.json");
assert(lockedDevDependencies.playwright === "1.61.1", "Playwright is pinned in package-lock.json");
assert(lockedDevDependencies["axe-core"] === "4.12.1", "axe-core is pinned in package-lock.json");
assert(!/npm install --no-save playwright axe-core/.test(workflow), "CI never installs floating latest test dependencies");
assert(/\.\/\.github\/actions\/build-extension/.test(workflow), "CI uses the shared locked build action");
assert(/npm ci --ignore-scripts/.test(action), "the shared action installs the lockfile exactly");
assert(/cache-dependency-path: package-lock\.json/.test(action), "Node dependency caching follows the lockfile");
assert(/npx playwright install --with-deps chromium/.test(workflow), "the matching Chromium build and system dependencies are installed");

console.log("14-ci-reproducibility PASS");
