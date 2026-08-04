// Lifejacket settings and manifest contract. Legacy Caveman values migrate once,
// while every shipped provider surface loads the new settings/controller pair.
import vm from "node:vm";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { EXT_PATH, assert } from "./lib.mjs";

const manifest = JSON.parse(readFileSync(join(EXT_PATH, "manifest.json"), "utf8"));
assert(manifest.version === "1.3.0", `expected Lifejacket release version 1.3.0, got ${manifest.version}`);

const isolatedScripts = (manifest.content_scripts || []).filter(entry => entry.world !== "MAIN");
const claude = isolatedScripts.find(entry => entry.js?.includes("src/content.js"));
const openai = isolatedScripts.find(entry => entry.js?.includes("src/openai-content.js"));
assert(claude, "Claude isolated content script exists");
assert(openai, "OpenAI isolated content script exists");

for (const [name, entry] of [["Claude", claude], ["OpenAI", openai]]) {
  const scripts = entry.js || [];
  const sharedAt = scripts.indexOf("src/shared.js");
  const settingsAt = scripts.indexOf("src/lifejacket-settings.js");
  const controllerAt = scripts.indexOf("src/lifejacket.js");
  const contentAt = scripts.indexOf(name === "Claude" ? "src/content.js" : "src/openai-content.js");
  assert(sharedAt >= 0 && sharedAt < settingsAt && settingsAt < controllerAt && controllerAt < contentAt,
    `${name} loads shared, Lifejacket settings, controller, and content in dependency order`);
  assert(!scripts.includes("src/caveman.js"), `${name} no longer ships caveman.js`);
}

const context = {
  console: { log() {}, warn() {}, error() {} },
  Date,
  Intl,
  Math,
  TextEncoder,
  TextDecoder,
  URL,
  setTimeout,
  clearTimeout,
};
context.globalThis = context;
vm.createContext(context);
vm.runInContext(readFileSync(join(EXT_PATH, "src", "shared.js"), "utf8"), context, { filename: "shared.js" });
vm.runInContext(readFileSync(join(EXT_PATH, "src", "lifejacket-settings.js"), "utf8"), context, { filename: "lifejacket-settings.js" });

const CUC = context.ClaudeUsageCompanion;
assert(CUC, "shared Companion namespace exists");
const expectedDefaults = {
  lifejacketMode: false,
  showLifejacketMode: true,
  lifejacketPromptCompression: true,
  lifejacketReplyBrevity: true,
  lifejacketFileConversion: true,
};
for (const [key, value] of Object.entries(expectedDefaults)) {
  assert(CUC.DEFAULT_SETTINGS[key] === value, `${key} defaults to ${value}`);
}

const migrated = CUC.mergeSettings({
  cavemanMode: true,
  showCavemanMode: false,
  showWidget: false,
});
assert(migrated.lifejacketMode === true, "legacy cavemanMode migrates to lifejacketMode");
assert(migrated.showLifejacketMode === false, "legacy showCavemanMode migrates to showLifejacketMode");
assert(migrated.showWidget === false, "unrelated settings survive migration");
assert(!Object.prototype.hasOwnProperty.call(migrated, "cavemanMode"), "legacy cavemanMode is not returned");
assert(!Object.prototype.hasOwnProperty.call(migrated, "showCavemanMode"), "legacy showCavemanMode is not returned");

const explicit = CUC.mergeSettings({
  cavemanMode: true,
  showCavemanMode: false,
  lifejacketMode: false,
  showLifejacketMode: true,
  lifejacketPromptCompression: false,
  lifejacketReplyBrevity: false,
  lifejacketFileConversion: false,
});
assert(explicit.lifejacketMode === false, "explicit new master setting wins over legacy value");
assert(explicit.showLifejacketMode === true, "explicit new visibility setting wins over legacy value");
assert(explicit.lifejacketPromptCompression === false, "prompt compression is independently configurable");
assert(explicit.lifejacketReplyBrevity === false, "reply brevity is independently configurable");
assert(explicit.lifejacketFileConversion === false, "file conversion is independently configurable");

const optionsHtml = readFileSync(join(EXT_PATH, "src", "options.html"), "utf8");
for (const key of Object.keys(expectedDefaults)) {
  assert(optionsHtml.includes(`data-setting="${key}"`), `Settings exposes ${key}`);
}
assert(optionsHtml.includes("Lifejacket Mode"), "Settings uses the Lifejacket Mode product name");
assert(!optionsHtml.includes("Show Caveman Mode"), "Settings no longer exposes Caveman Mode copy");

console.log("19-lifejacket-settings PASS");
