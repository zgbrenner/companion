// Generates update/manifest.json: the file list + SHA-256 hashes the
// in-extension self-updater (src/updater.js) downloads and verifies.
// Run from the repo root: node tools/build-update-manifest.mjs
// The publish-update-manifest GitHub Action runs this on every push to main.
//
// Deliberately no timestamp field: identical content must produce an
// identical file, so the Action's "commit only if changed" check stays quiet
// on pushes that don't touch shipped files.
import { createHash } from "node:crypto";
import { readFile, writeFile, readdir, mkdir } from "node:fs/promises";
import { join, relative, sep } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const SHIPPED_DIRS = ["src", "icons"];

async function listFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...await listFiles(full));
    else if (entry.isFile()) files.push(full);
  }
  return files;
}

async function hashFile(path) {
  const data = await readFile(path);
  return createHash("sha256").update(data).digest("hex");
}

const manifest = JSON.parse(await readFile(join(ROOT, "manifest.json"), "utf8"));

const paths = [join(ROOT, "manifest.json")];
for (const dir of SHIPPED_DIRS) {
  paths.push(...await listFiles(join(ROOT, dir)));
}

const files = [];
for (const path of paths.sort()) {
  const repoPath = relative(ROOT, path).split(sep).join("/");
  files.push({ path: repoPath, sha256: await hashFile(path) });
}

const output = { version: manifest.version, files };
await mkdir(join(ROOT, "update"), { recursive: true });
await writeFile(join(ROOT, "update", "manifest.json"), `${JSON.stringify(output, null, 2)}\n`);
console.log(`update/manifest.json written: v${output.version}, ${files.length} files`);
