import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sharedVendorRoot = path.join(root, 'src', 'vendor');
const outputRoot = path.join(sharedVendorRoot, 'lifejacket');
const ortOutput = path.join(outputRoot, 'ort');
const licenseOutput = path.join(outputRoot, 'licenses');
const packageCache = path.join(root, '.cache', 'lifejacket', 'npm');
const extractionRoot = path.join(root, '.cache', 'lifejacket', 'runtime-packages');
const protectedSharedAssets = [
  path.join(sharedVendorRoot, 'officeparser.browser.slim.iife.js'),
  path.join(sharedVendorRoot, 'pdf.worker.min.mjs'),
];
const staticLicenseSources = {
  onnxruntime: path.join(root, 'third_party', 'licenses', 'onnxruntime-MIT.txt'),
};
const PACKAGES = Object.freeze({
  transformers: {
    name: '@huggingface/transformers',
    version: '4.2.0',
    url: 'https://registry.npmjs.org/@huggingface/transformers/-/transformers-4.2.0.tgz',
    integrity: 'sha512-8BRCoBMH0XsWaEIamuR0LrJGAfftgHAfb2Vrffy0VKlSAE/MnUJ5/h/zTfEP3fDIft+nk7TqB8xXEyABGitBjQ==',
    archive: 'huggingface-transformers-4.2.0.tgz',
    directory: 'transformers',
    license: 'Apache-2.0',
  },
  onnxruntime: {
    name: 'onnxruntime-web',
    version: '1.26.0-dev.20260416-b7804b056c',
    url: 'https://registry.npmjs.org/onnxruntime-web/-/onnxruntime-web-1.26.0-dev.20260416-b7804b056c.tgz',
    integrity: 'sha512-MD6Ss4GSpQBo6zqoJzyT9LRbKYs7x/JVN23FT24EcEvlqF4VuzPOeH6X38orZPKHQDbprn7K+SBpu0/mj2CQiw==',
    archive: 'onnxruntime-web-1.26.0-dev.20260416-b7804b056c.tgz',
    directory: 'onnxruntime-web',
    license: 'MIT',
  },
});

function digest(file, algorithm = 'sha256', encoding = 'hex') {
  return crypto.createHash(algorithm).update(fs.readFileSync(file)).digest(encoding);
}

function copy(source, destination) {
  if (!fs.existsSync(source) || !fs.statSync(source).isFile()) {
    throw new Error(`Required vendored source is missing: ${path.relative(root, source)}`);
  }
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.copyFileSync(source, destination);
  fs.chmodSync(destination, 0o644);
}

function verifyIntegrity(file, expected) {
  const match = /^(sha512)-(.+)$/.exec(expected);
  if (!match) throw new Error(`Unsupported package integrity: ${expected}`);
  const actual = digest(file, match[1], 'base64');
  if (actual !== match[2]) {
    throw new Error(`Pinned package integrity mismatch for ${path.basename(file)}`);
  }
}

async function downloadPackage(spec) {
  fs.mkdirSync(packageCache, { recursive: true });
  const archive = path.join(packageCache, spec.archive);
  if (fs.existsSync(archive)) {
    try {
      verifyIntegrity(archive, spec.integrity);
      return archive;
    } catch {
      fs.rmSync(archive, { force: true });
    }
  }
  const temporary = `${archive}.tmp-${process.pid}`;
  const response = await fetch(spec.url, {
    redirect: 'follow',
    headers: { 'user-agent': 'COMPANION-Lifejacket-build/1.3.0' },
  });
  if (!response.ok) throw new Error(`Unable to download ${spec.name}: HTTP ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  fs.writeFileSync(temporary, bytes, { mode: 0o644 });
  try {
    verifyIntegrity(temporary, spec.integrity);
    fs.renameSync(temporary, archive);
  } finally {
    fs.rmSync(temporary, { force: true });
  }
  return archive;
}

function extractPackage(archive, spec) {
  const destination = path.join(extractionRoot, spec.directory);
  fs.rmSync(destination, { recursive: true, force: true });
  fs.mkdirSync(destination, { recursive: true });
  const command = spawnSync('tar', [
    '-xzf', archive,
    '--strip-components=1',
    '-C', destination,
  ], { encoding: 'utf8' });
  if (command.error || command.status !== 0) {
    throw new Error(`Unable to extract ${spec.name}: ${command.error?.message || command.stderr || `exit ${command.status}`}`);
  }
  const metadataPath = path.join(destination, 'package.json');
  if (!fs.existsSync(metadataPath)) throw new Error(`Extracted ${spec.name} is missing package.json`);
  const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
  if (metadata.name !== spec.name || metadata.version !== spec.version || metadata.license !== spec.license) {
    throw new Error(`Extracted package metadata mismatch for ${spec.name}`);
  }
  return destination;
}

const sharedAssetHashes = new Map();
for (const file of protectedSharedAssets) {
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) {
    throw new Error(`Required shared conversion dependency is missing: ${path.relative(root, file)}`);
  }
  sharedAssetHashes.set(file, digest(file));
}

const transformerArchive = await downloadPackage(PACKAGES.transformers);
const ortArchive = await downloadPackage(PACKAGES.onnxruntime);
const transformersRoot = extractPackage(transformerArchive, PACKAGES.transformers);
const ortRoot = extractPackage(ortArchive, PACKAGES.onnxruntime);

// Delete only Lifejacket's generated namespace. src/vendor also contains the
// sandboxed Office parser and PDF worker, which must survive every ML rebuild.
fs.rmSync(outputRoot, { recursive: true, force: true });
fs.mkdirSync(ortOutput, { recursive: true });
fs.mkdirSync(licenseOutput, { recursive: true });

copy(
  path.join(transformersRoot, 'dist', 'transformers.web.min.js'),
  path.join(outputRoot, 'transformers.web.min.js'),
);

// Lifejacket intentionally uses the stable CPU WASM execution provider with
// one thread. Copying only this pair avoids shipping WebGPU, JSEP, JSPI,
// asyncify, Node, image-processing, or native runtime dependencies.
for (const filename of ['ort-wasm-simd-threaded.mjs', 'ort-wasm-simd-threaded.wasm']) {
  copy(path.join(ortRoot, 'dist', filename), path.join(ortOutput, filename));
}

copy(path.join(transformersRoot, 'LICENSE'), path.join(licenseOutput, 'transformers-js-APACHE-2.0.txt'));
copy(staticLicenseSources.onnxruntime, path.join(licenseOutput, 'onnxruntime-MIT.txt'));

const runtimeSource = fs.readFileSync(path.join(root, 'src', 'lifejacket-runtime.js'), 'utf8');
if (!/env\.allowRemoteModels\s*=\s*false/.test(runtimeSource)) {
  throw new Error('Lifejacket runtime must set env.allowRemoteModels = false');
}
if (/import\s*\(\s*['"]https?:\/\//.test(runtimeSource) || /from\s+['"]https?:\/\//.test(runtimeSource)) {
  throw new Error('Lifejacket runtime contains a remote module import');
}
for (const [file, expectedHash] of sharedAssetHashes) {
  if (!fs.existsSync(file) || digest(file) !== expectedHash) {
    throw new Error(`Lifejacket vendoring modified a shared conversion dependency: ${path.relative(root, file)}`);
  }
}

const files = [];
for (const file of fs.readdirSync(outputRoot, { recursive: true })) {
  const absolute = path.join(outputRoot, file);
  if (!fs.statSync(absolute).isFile() || file === 'vendor-manifest.json') continue;
  files.push({
    path: file.split(path.sep).join('/'),
    bytes: fs.statSync(absolute).size,
    sha256: digest(absolute),
  });
}
files.sort((a, b) => a.path.localeCompare(b.path));
const manifest = {
  schema: 1,
  packages: Object.fromEntries(Object.values(PACKAGES).map(spec => [spec.name, spec.version])),
  sources: Object.fromEntries(Object.values(PACKAGES).map(spec => [spec.name, {
    url: spec.url,
    integrity: spec.integrity,
  }])),
  licenses: Object.fromEntries(Object.values(PACKAGES).map(spec => [spec.name, spec.license])),
  policy: {
    allowRemoteModels: false,
    executionProvider: 'wasm',
    wasmThreads: 1,
    namespace: 'src/vendor/lifejacket',
    preservesSharedVendorAssets: true,
    installsPackageDependencies: false,
  },
  files,
};
fs.writeFileSync(
  path.join(outputRoot, 'vendor-manifest.json'),
  `${JSON.stringify(manifest, null, 2)}\n`,
  'utf8',
);
console.log(`Vendored ${files.length} Lifejacket browser files (${files.reduce((sum, file) => sum + file.bytes, 0)} bytes).`);
