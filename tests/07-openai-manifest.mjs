// Manifest contract for multi-provider isolation. Claude's shipped arrays must
// stay intact while OpenAI gets its own isolated and MAIN-world scripts.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { EXT_PATH, assert } from "./lib.mjs";

const manifest = JSON.parse(readFileSync(join(EXT_PATH, "manifest.json"), "utf8"));
assert(manifest.version === "1.2.0", `expected version 1.2.0, got ${manifest.version}`);
assert(manifest.background?.service_worker === "src/service-worker.js", "composite service worker is configured");
assert(manifest.action?.default_popup === "src/popup-router.html", "provider-aware popup router is configured");

const hosts = new Set(manifest.host_permissions || []);
for (const host of [
  "https://claude.ai/*",
  "https://*.claude.ai/*",
  "https://chatgpt.com/*",
  "https://*.chatgpt.com/*",
  "https://chat.openai.com/*",
]) {
  assert(hosts.has(host), `missing host permission ${host}`);
}
assert(!hosts.has("<all_urls>"), "extension must not request all URLs");

const scripts = manifest.content_scripts || [];
const claudeIsolated = scripts.find(entry =>
  entry.world !== "MAIN" && entry.js?.includes("src/content.js"));
assert(claudeIsolated, "legacy Claude isolated script exists");
assert(JSON.stringify(claudeIsolated.js) === JSON.stringify([
  "src/shared.js",
  "src/native-usage.js",
  "src/caveman.js",
  "src/content.js",
]), "legacy Claude script order is unchanged");

const claudeMain = scripts.find(entry => entry.world === "MAIN" && entry.js?.includes("src/injected.js"));
assert(claudeMain, "legacy Claude MAIN-world observer exists");

const openaiIsolated = scripts.find(entry =>
  entry.world !== "MAIN" && entry.js?.includes("src/openai-content.js"));
assert(openaiIsolated, "OpenAI isolated script exists");
assert(JSON.stringify(openaiIsolated.js) === JSON.stringify([
  "src/shared.js",
  "src/caveman.js",
  "src/platform.js",
  "src/openai-channel.js",
  "src/openai-content.js",
]), "OpenAI secret-channel adapter loads immediately before the content script");

const openaiMain = scripts.find(entry => entry.world === "MAIN" && entry.js?.includes("src/openai-injected.js"));
assert(openaiMain, "OpenAI MAIN-world observer exists");
for (const match of openaiMain.matches || []) {
  assert(/chatgpt\.com|chat\.openai\.com/.test(match), `unexpected OpenAI match ${match}`);
}

const resources = manifest.web_accessible_resources || [];
const openaiResources = resources.find(entry => entry.resources?.includes("src/openai-widget.css"));
assert(openaiResources, "OpenAI shadow widget stylesheet is web accessible");

console.log("07-openai-manifest PASS");
