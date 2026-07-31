import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const TRANSFORMERS_VERSION = '4.2.0';
const ORT_WEB_VERSION = '1.26.0-dev.20260416-b7804b056c';
const sharedVendorRoot = path.join(root, 'src', 'vendor');
const outputRoot = path.join(root, 'src', 'vendor', 'lifejacket');
const ortOutput = path.join(outputRoot, 'ort');
const licenseOutput = path.join(outputRoot, 'licenses');
const protectedSharedAssets = [
  path.join(sharedVendorRoot, 'officeparser.browser.slim.iife.js'),
  path.join(sharedVendorRoot, 'pdf.worker.min.mjs'),
];

function packageRoot(name) {
  let directory = path.dirname(require.resolve(name, { paths: [root] }));
  while (directory !== path.dirname(directory)) {
    const candidate = path.join(directory, 'package.json');
    if (fs.existsSync(candidate)) {
      const metadata = JSON.parse(fs.readFileSync(candidate, 'utf8'));
      if (metadata.name === name) return directory;
    }
    directory = path.dirname(directory);
  }
  throw new Error(`Unable to locate package root for ${name}`);
}

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function copy(source, destination) {
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.copyFileSync(source, destination);
  fs.chmodSync(destination, 0o644);
}

function readPackage(directory) {
  return JSON.parse(fs.readFileSync(path.join(directory, 'package.json'), 'utf8'));
}

const sharedAssetHashes = new Map();
for (const file of protectedSharedAssets) {
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) {
    throw new Error(`Required shared conversion dependency is missing: ${path.relative(root, file)}`);
  }
  sharedAssetHashes.set(file, sha256(file));
}

const transformersRoot = packageRoot('@huggingface/transformers');
const ortRoot = packageRoot('onnxruntime-web');
const transformersPackage = readPackage(transformersRoot);
const ortPackage = readPackage(ortRoot);
if (transformersPackage.version !== TRANSFORMERS_VERSION) {
  throw new Error(`Expected @huggingface/transformers ${TRANSFORMERS_VERSION}, found ${transformersPackage.version}`);
}
if (ortPackage.version !== ORT_WEB_VERSION) {
  throw new Error(`Expected onnxruntime-web ${ORT_WEB_VERSION}, found ${ortPackage.version}`);
}

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
// one thread. Copying only this pair avoids shipping WebGPU, JSEP, JSPI, and
// asyncify runtimes that the extension never selects.
for (const filename of [
  'ort-wasm-simd-threaded.mjs',
  'ort-wasm-simd-threaded.wasm',
]) {
  const source = path.join(ortRoot, 'dist', filename);
  if (!fs.existsSync(source)) throw new Error(`Required ONNX Runtime asset is missing: ${filename}`);
  copy(source, path.join(ortOutput, filename));
}

copy(path.join(transformersRoot, 'LICENSE'), path.join(licenseOutput, 'transformers-js-APACHE-2.0.txt'));
copy(path.join(ortRoot, 'LICENSE'), path.join(licenseOutput, 'onnxruntime-MIT.txt'));

const runtimeSource = fs.readFileSync(path.join(root, 'src', 'lifejacket-runtime.js'), 'utf8');
if (!/env\.allowRemoteModels\s*=\s*false/.test(runtimeSource)) {
  throw new Error('Lifejacket runtime must set env.allowRemoteModels = false');
}
if (/import\s*\(\s*['"]https?:\/\//.test(runtimeSource) || /from\s+['"]https?:\/\//.test(runtimeSource)) {
  throw new Error('Lifejacket runtime contains a remote module import');
}

for (const [file, expectedHash] of sharedAssetHashes) {
  if (!fs.existsSync(file) || sha256(file) !== expectedHash) {
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
    sha256: sha256(absolute),
  });
}
files.sort((a, b) => a.path.localeCompare(b.path));
const manifest = {
  schema: 1,
  packages: {
    '@huggingface/transformers': TRANSFORMERS_VERSION,
    'onnxruntime-web': ORT_WEB_VERSION,
  },
  policy: {
    allowRemoteModels: false,
    executionProvider: 'wasm',
    wasmThreads: 1,
    namespace: 'src/vendor/lifejacket',
    preservesSharedVendorAssets: true,
  },
  files,
};
fs.writeFileSync(
  path.join(outputRoot, 'vendor-manifest.json'),
  `${JSON.stringify(manifest, null, 2)}\n`,
  'utf8',
);
console.log(`Vendored ${files.length} Lifejacket runtime files (${files.reduce((sum, file) => sum + file.bytes, 0)} bytes).`);
