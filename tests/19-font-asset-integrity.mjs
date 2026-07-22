// Every runtime font reference must resolve to a bundled production asset.
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, extname, join, relative } from "node:path";
import { EXT_PATH, assert } from "./lib.mjs";

function filesUnder(root) {
  const result = [];
  for (const name of readdirSync(root)) {
    const path = join(root, name);
    if (statSync(path).isDirectory()) result.push(...filesUnder(path));
    else result.push(path);
  }
  return result;
}

const runtimeFiles = filesUnder(join(EXT_PATH, "src"))
  .filter(path => [".css", ".html", ".js"].includes(extname(path)));

for (const path of runtimeFiles) {
  const source = readFileSync(path, "utf8");
  const name = relative(EXT_PATH, path);
  assert(!/space-grotesk/i.test(source), `${name} contains a stale Space Grotesk reference`);

  for (const match of source.matchAll(/url\(["']?([^"')]+\.(?:woff2?|ttf))["']?\)/gi)) {
    const ref = match[1];
    if (/^(?:https?:|data:|chrome-extension:)/i.test(ref)) continue;
    const asset = /^(?:src|icons)\//.test(ref)
      ? join(EXT_PATH, ref)
      : join(dirname(path), ref);
    assert(existsSync(asset), `${name} references missing local font ${ref}`);
  }
}

for (const forbidden of [
  "src/fonts/space-grotesk-latin.woff2",
  "src/fonts/league-spartan-variable.ttf",
  "src/fonts/atkinson-hyperlegible-next-variable.ttf",
]) {
  assert(!existsSync(join(EXT_PATH, forbidden)), `${forbidden} is excluded from the production asset set`);
}

console.log("19-font-asset-integrity PASS");
