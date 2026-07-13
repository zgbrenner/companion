// Generates update/manifest.json: the file list + SHA-256 hashes the
// in-extension self-updater (src/updater.js) downloads and verifies.
// Run from the repo root: node tools/build-update-manifest.mjs
// The publish-update-manifest GitHub Action runs this on every push to main.
//
// Deliberately no timestamp field: identical content must produce an
// identical file, so the Action's "commit only if changed" check stays quiet
// on pushes that don't touch shipped files.
import { createHash, webcrypto } from "node:crypto";
import { execSync } from "node:child_process";
import { readFile, writeFile, readdir, mkdir } from "node:fs/promises";
import { join, relative, sep } from "node:path";

// MUST stay byte-for-byte in sync with canonicalUpdatePayload() in
// src/updater.js — the client verifies exactly these bytes.
function canonicalUpdatePayload(manifest) {
  const files = manifest.files
    .map(file => `${file.path}\t${String(file.sha256).toLowerCase()}`)
    .join("\n");
  return `cuc-update-v1\nversion:${manifest.version}\ncommit:${manifest.commit || ""}\n${files}\n`;
}

// The commit the client pins file downloads to. In CI this is the source
// commit that triggered the workflow (GITHUB_SHA); locally it's HEAD.
function detectCommit() {
  if (process.env.GITHUB_SHA) return process.env.GITHUB_SHA.trim();
  try {
    return execSync("git rev-parse HEAD", { cwd: ROOT }).toString().trim();
  } catch {
    return "";
  }
}

// Sign the manifest with the ECDSA P-256 private key from the environment
// (the CUC_UPDATE_SIGNING_KEY GitHub Actions secret, base64 PKCS8). Without
// it the manifest ships unsigned — clients that have a public key baked in
// will then refuse the update, which is the intended fail-closed behavior.
async function signManifest(output) {
  const keyB64 = process.env.CUC_UPDATE_SIGNING_KEY;
  if (!keyB64) {
    console.warn("CUC_UPDATE_SIGNING_KEY not set — manifest is UNSIGNED (hash-only integrity).");
    return;
  }
  const key = await webcrypto.subtle.importKey(
    "pkcs8",
    Buffer.from(keyB64, "base64"),
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"]
  );
  const signature = await webcrypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    key,
    Buffer.from(canonicalUpdatePayload(output), "utf8")
  );
  output.signature = Buffer.from(signature).toString("base64");
  output.signatureAlg = "ECDSA-P256-SHA256";
  console.log("update/manifest.json signed.");
}

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

const output = { version: manifest.version, commit: detectCommit(), files };
// Sign BEFORE serializing; the signature covers version + commit + file
// hashes (canonicalUpdatePayload ignores the signature field itself).
await signManifest(output);
await mkdir(join(ROOT, "update"), { recursive: true });
await writeFile(join(ROOT, "update", "manifest.json"), `${JSON.stringify(output, null, 2)}\n`);
console.log(`update/manifest.json written: v${output.version}, commit ${(output.commit || "none").slice(0, 12)}, ${files.length} files`);
