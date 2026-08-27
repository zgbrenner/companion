// Public release contract for the current COMPANION release.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { EXT_PATH, assert } from "./lib.mjs";

const pathFor = path => join(EXT_PATH, path);
const read = path => readFileSync(pathFor(path), "utf8");
const mustExist = path => assert(existsSync(pathFor(path)), `${path} exists`);

const manifest = JSON.parse(read("manifest.json"));
const version = manifest.version;
assert(manifest.name === "COMPANION", "release keeps the all-caps product name");
assert(version === "1.4.1", "release version is 1.4.1");

const changelog = read("CHANGELOG.md");
assert(changelog.includes(`### ${version}`), `changelog has a finalized ${version} section`);
assert(!changelog.includes("### Unreleased (OpenAI hardening)"), "OpenAI work is no longer labeled unreleased");

const readme = read("README.md");
assert(readme.includes("<h1>COMPANION</h1>"), "README uses the approved wordmark");
for (const term of ["Claude", "ChatGPT", "Work", "Codex", "Chrome Web Store", "privacy"]) {
  assert(readme.includes(term), `README includes ${term}`);
}
assert(readme.includes("store/screenshots/02-claude-usage.png"), "README includes an existing product render");

const listing = read("store/listing.md");
assert(listing.includes("Chrome Web Store Listing — COMPANION"), "store listing uses the current brand");
assert(listing.includes("Claude") && listing.includes("ChatGPT"), "store listing describes both providers");
assert(listing.includes("132 characters or fewer"), "store listing records the summary limit");
assert(!listing.includes("Companion only talks to claude.ai"), "store copy does not make the stale Claude-only claim");

const privacy = read("store/privacy-policy.md");
assert(privacy.includes("Last updated: August 4, 2026"), "privacy policy date is current");
for (const term of ["claude.ai", "chatgpt.com", "chat.openai.com", "OpenAI usage snapshot", "No analytics"]) {
  assert(privacy.includes(term), `privacy policy includes ${term}`);
}
assert(!privacy.includes("communicates with **claude.ai only**"), "privacy policy is not Claude-only");

const permissions = read("store/permission-justifications.md");
for (const term of [
  "### `alarms`",
  "chatgpt.com",
  "chat.openai.com",
  "No, I am not using remote code",
  "Website content",
  "Personal communications",
  "User activity",
]) {
  assert(permissions.includes(term), `permission disclosure includes ${term}`);
}

const checklist = read("store/submission-checklist.md");
for (const term of [`COMPANION v${version}`, "2-step verification", "deferred publishing", "store/test-instructions.md", "1400×560"]) {
  assert(checklist.includes(term), `submission checklist includes ${term}`);
}

for (const path of [
  `RELEASE_NOTES_${version}.md`,
  "store/test-instructions.md",
  "store/reviewer-notes.md",
  "docs/launch/LAUNCH_PLAYBOOK.md",
  "docs/launch/LAUNCH_COPY.md",
  "docs/launch/PRESS_KIT.md",
  "docs/launch/PRIVACY_SAFE_GROWTH_METRICS.md",
  "docs/superpowers/specs/2026-07-21-release-growth-design.md",
  "docs/superpowers/plans/2026-07-21-release-growth.md",
  ".gitattributes",
  ".github/workflows/release-package.yml",
  "tools/generate-launch-assets.py",
]) mustExist(path);

const releaseWorkflow = read(".github/workflows/release-package.yml");
const lineEndings = read(".gitattributes");
assert(lineEndings.includes("*.sh text eol=lf"), "shell entry points force LF endings");
for (const term of [
  "workflow_dispatch",
  "tools/package-webstore.sh",
  "tools/generate-launch-assets.py",
  "sha256sum",
  "actions/upload-artifact@v4",
  "companion-v${{ steps.metadata.outputs.version }}-launch-assets",
]) {
  assert(releaseWorkflow.includes(term), `release workflow includes ${term}`);
}

const launchCopy = read("docs/launch/LAUNCH_COPY.md");
assert(launchCopy.includes("Product Hunt"), "launch copy includes Product Hunt");
assert(launchCopy.includes("Hacker News"), "launch copy includes Hacker News");
assert(launchCopy.includes("Reddit"), "launch copy includes Reddit");
assert(!/ask[^\n]{0,35}upvote/i.test(launchCopy), "launch copy does not ask for upvotes");

const images = new Map([
  ["store/promo-tile-440x280.png", [440, 280]],
  ["store/marquee-1400x560.png", [1400, 560]],
  ["store/screenshots/01-overview.png", [1280, 800]],
  ["store/screenshots/02-claude-usage.png", [1280, 800]],
  ["store/screenshots/03-chatgpt-work-codex.png", [1280, 800]],
  ["store/screenshots/04-settings-privacy.png", [1280, 800]],
  ["store/screenshots/05-local-efficiency-tools.png", [1280, 800]],
  ["docs/launch/assets/product-hunt-thumbnail-240x240.png", [240, 240]],
  ["docs/launch/assets/product-hunt-gallery-01-1270x760.png", [1270, 760]],
  ["docs/launch/assets/product-hunt-gallery-02-1270x760.png", [1270, 760]],
  ["docs/launch/assets/product-hunt-gallery-03-1270x760.png", [1270, 760]],
  ["docs/launch/assets/social-card-1200x630.png", [1200, 630]],
]);

const generator = read("tools/generate-launch-assets.py");
for (const [path, expected] of images) {
  assert(generator.includes(path), `asset generator declares ${path}`);
  assert(generator.includes(`(${expected[0]}, ${expected[1]})`), `asset generator declares ${expected[0]}x${expected[1]}`);
}

const generatedAssetsPresent = [...images.keys()].every(path => existsSync(pathFor(path)));
if (generatedAssetsPresent) {
  for (const [path, expected] of images) {
    const bytes = readFileSync(pathFor(path));
    assert(bytes.subarray(1, 4).toString("ascii") === "PNG", `${path} is a PNG`);
    const actual = [bytes.readUInt32BE(16), bytes.readUInt32BE(20)];
    assert(actual[0] === expected[0] && actual[1] === expected[1], `${path} is ${expected[0]}x${expected[1]}`);
  }
} else {
  assert(process.env.REQUIRE_GENERATED_LAUNCH_ASSETS !== "1", "release workflow must generate every required launch asset");
}

console.log("20-release-readiness PASS");
