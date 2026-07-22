// Direction 1 brand contract: Orbit C, all-caps COMPANION, and bundled fonts.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { EXT_PATH, assert } from "./lib.mjs";

const read = path => readFileSync(join(EXT_PATH, path), "utf8");
const manifest = JSON.parse(read("manifest.json"));
const fonts = read("src/fonts.css");
const popup = read("src/popup.html");
const popupCss = read("src/popup.css");
const router = read("src/popup-router.html");
const openaiPopup = read("src/openai-popup.html");
const openaiPopupCss = read("src/openai-popup.css");
const options = read("src/options.html");
const optionsCss = read("src/options.css");
const widgetCss = read("src/widget.css");
const openaiWidgetCss = read("src/openai-widget.css");
const claudeContent = read("src/content.js");
const openaiContent = read("src/openai-content.js");

assert(manifest.name === "COMPANION", "manifest brand name is always all caps");
assert(manifest.action?.default_title === "COMPANION", "toolbar title is always all caps");

for (const [name, source] of [
  ["popup", popup],
  ["popup router", router],
  ["OpenAI popup", openaiPopup],
  ["settings", options],
]) {
  assert(!/>Companion</.test(source), `${name} does not render title-case brand text`);
  assert(source.includes("COMPANION"), `${name} renders the all-caps brand`);
}

assert(fonts.includes('font-family: "League Spartan"'), "bundled League Spartan face is registered");
assert(fonts.includes('font-family: "Atkinson Hyperlegible Next"'), "bundled Atkinson Hyperlegible Next face is registered");
assert(fonts.includes("fonts/league-spartan-variable.ttf"), "League Spartan loads from the extension bundle");
assert(fonts.includes("fonts/atkinson-hyperlegible-next-variable.ttf"), "Atkinson loads from the extension bundle");
assert(!/https?:\/\//i.test(fonts), "font stylesheet makes no external request");

for (const path of [
  "src/fonts/league-spartan-variable.ttf",
  "src/fonts/atkinson-hyperlegible-next-variable.ttf",
]) {
  assert(existsSync(join(EXT_PATH, path)), `${path} is bundled locally`);
}

for (const [name, source] of [
  ["popup CSS", popupCss],
  ["OpenAI popup CSS", openaiPopupCss],
  ["settings CSS", optionsCss],
  ["Claude widget CSS", widgetCss],
  ["OpenAI widget CSS", openaiWidgetCss],
]) {
  assert(source.includes('"Atkinson Hyperlegible Next"'), `${name} uses the readable UI typeface`);
  assert(source.includes('"League Spartan"'), `${name} uses the brand typeface`);
  assert(!source.includes('"Space Grotesk"'), `${name} no longer uses the old display font`);
}

assert(claudeContent.includes("league-spartan-variable.ttf"), "Claude registers the bundled brand font in the host page");
assert(claudeContent.includes("atkinson-hyperlegible-next-variable.ttf"), "Claude registers the bundled UI font in the host page");
assert(openaiContent.includes("league-spartan-variable.ttf"), "OpenAI registers the bundled brand font in the host page");
assert(openaiContent.includes("atkinson-hyperlegible-next-variable.ttf"), "OpenAI registers the bundled UI font in the host page");

const resources = manifest.web_accessible_resources.flatMap(entry => entry.resources || []);
for (const resource of [
  "src/fonts/league-spartan-variable.ttf",
  "src/fonts/atkinson-hyperlegible-next-variable.ttf",
]) {
  assert(resources.includes(resource), `${resource} is web-accessible only on declared provider origins`);
}
assert(!resources.includes("src/fonts/space-grotesk-latin.woff2"), "old display font is no longer exposed");

const iconSvg = read("icons/orbit-c.svg");
assert(iconSvg.includes("#111827"), "Orbit C uses the graphite foundation");
assert(iconSvg.includes("#35D6A6"), "Orbit C uses the mint accent");
assert(iconSvg.includes("aria-label=\"COMPANION Orbit C icon\""), "source icon has an accessible identity");

function pngDimensions(path) {
  const bytes = readFileSync(join(EXT_PATH, path));
  assert(bytes.subarray(1, 4).toString("ascii") === "PNG", `${path} is a PNG`);
  return [bytes.readUInt32BE(16), bytes.readUInt32BE(20)];
}
for (const size of [16, 32, 48, 128]) {
  const path = `icons/icon${size}.png`;
  const [width, height] = pngDimensions(path);
  assert(width === size && height === size, `${path} is exactly ${size} by ${size}`);
}

const allProductText = [manifest.description, popup, router, openaiPopup, options].join("\n");
assert(!/fonts\.googleapis|fonts\.gstatic|use\.typekit/i.test(allProductText + fonts), "product makes no third-party font request");

console.log("17-brand-identity PASS");
