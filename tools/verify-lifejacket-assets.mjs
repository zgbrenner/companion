import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const vendorRoot = path.join(root, 'src', 'vendor', 'lifejacket');
const modelRoot = path.join(root, 'src', 'models', 'lifejacket');
const MAX_MODEL_BYTES = 40 * 1024 * 1024;
const MAX_TOTAL_BYTES = 55 * 1024 * 1024;

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function requireFile(file) {
  if (!fs.existsSync(file) || !fs.statSync(file).isFile() || fs.statSync(file).size === 0) {
    throw new Error(`Required Lifejacket asset is missing or empty: ${path.relative(root, file)}`);
  }
}

// Lifejacket shares src/vendor with the existing local document converter.
// Verify those assets still exist before accepting an ML build.
for (const sharedFile of [
  path.join(root, 'src', 'vendor', 'officeparser.browser.slim.iife.js'),
  path.join(root, 'src', 'vendor', 'pdf.worker.min.mjs'),
]) requireFile(sharedFile);

const vendorManifestPath = path.join(vendorRoot, 'vendor-manifest.json');
const provenancePath = path.join(modelRoot, 'provenance.json');
const sumsPath = path.join(modelRoot, 'SHA256SUMS');
const modelPath = path.join(modelRoot, 'onnx', 'model_quantized.onnx');
for (const file of [vendorManifestPath, provenancePath, sumsPath, modelPath]) requireFile(file);

const vendorManifest = JSON.parse(fs.readFileSync(vendorManifestPath, 'utf8'));
if (vendorManifest.packages?.['@huggingface/transformers'] !== '4.2.0') {
  throw new Error('Unexpected Transformers.js version in vendor manifest');
}
if (vendorManifest.packages?.['onnxruntime-web'] !== '1.26.0-dev.20260416-b7804b056c') {
  throw new Error('Unexpected ONNX Runtime Web version in vendor manifest');
}
if (vendorManifest.policy?.namespace !== 'src/vendor/lifejacket'
  || vendorManifest.policy?.preservesSharedVendorAssets !== true
  || vendorManifest.policy?.installsPackageDependencies !== false) {
  throw new Error('Lifejacket vendor isolation policy is missing');
}
for (const entry of vendorManifest.files || []) {
  const file = path.join(vendorRoot, entry.path);
  requireFile(file);
  if (fs.statSync(file).size !== entry.bytes || sha256(file) !== entry.sha256) {
    throw new Error(`Vendored asset integrity mismatch: ${entry.path}`);
  }
  if (/\.map$/i.test(entry.path)) throw new Error(`Source map must not be packaged: ${entry.path}`);
}

const provenance = JSON.parse(fs.readFileSync(provenancePath, 'utf8'));
if (provenance.source?.onnx?.sha256 !== 'caaadce5fa0fafce898c8ac2c152652a929ed5a2f55929eceb2f3325de4a2f07') {
  throw new Error('Lifejacket source model provenance does not match the pinned checkpoint');
}
const modelFileProvenance = provenance.model_files;
if (!modelFileProvenance || typeof modelFileProvenance !== 'object') {
  throw new Error('Lifejacket model metadata provenance is missing');
}
for (const [relative, expected] of Object.entries(modelFileProvenance)) {
  const file = path.resolve(modelRoot, relative);
  if (!file.startsWith(`${modelRoot}${path.sep}`)) throw new Error(`Invalid model metadata path: ${relative}`);
  requireFile(file);
  if (fs.statSync(file).size !== expected.bytes || sha256(file) !== expected.sha256) {
    throw new Error(`Model metadata provenance mismatch: ${relative}`);
  }
}
const modelBytes = fs.statSync(modelPath).size;
const modelHash = sha256(modelPath);
if (modelBytes >= MAX_MODEL_BYTES) throw new Error(`Lifejacket Q8 model exceeds ${MAX_MODEL_BYTES} bytes`);
if (provenance.output?.onnx?.bytes !== modelBytes || provenance.output?.onnx?.sha256 !== modelHash) {
  throw new Error('Lifejacket output model provenance mismatch');
}
if (fs.existsSync(path.join(modelRoot, 'onnx', 'model.onnx'))) {
  throw new Error('The FP32 source model must not be packaged');
}

const expectedSums = new Map(
  fs.readFileSync(sumsPath, 'utf8').trim().split(/\r?\n/).filter(Boolean).map(line => {
    const match = /^([a-f0-9]{64})  (.+)$/.exec(line);
    if (!match) throw new Error(`Malformed Lifejacket checksum line: ${line}`);
    return [match[2], match[1]];
  }),
);
for (const [relative, expected] of expectedSums) {
  const file = path.join(modelRoot, relative);
  requireFile(file);
  if (sha256(file) !== expected) throw new Error(`Model asset integrity mismatch: ${relative}`);
}

const totalBytes = [
  ...(vendorManifest.files || []).map(file => file.bytes),
  ...[...expectedSums.keys()].map(relative => fs.statSync(path.join(modelRoot, relative)).size),
].reduce((sum, value) => sum + value, 0);
if (totalBytes >= MAX_TOTAL_BYTES) throw new Error(`Lifejacket generated assets exceed ${MAX_TOTAL_BYTES} bytes: ${totalBytes}`);

const runtime = fs.readFileSync(path.join(root, 'src', 'lifejacket-runtime.js'), 'utf8');
if (/\b(?:import|export)\b[^\n]*https?:\/\//.test(runtime)) throw new Error('Remote module reference found in Lifejacket runtime');
if (!/env\.allowRemoteModels\s*=\s*false/.test(runtime)) throw new Error('Remote model loading is not disabled');
if (!/vendor\/lifejacket\/transformers\.web\.min\.js/.test(runtime)) throw new Error('Runtime is not using the namespaced vendor bundle');

const report = {
  schema: 1,
  model: { bytes: modelBytes, sha256: modelHash, maximumBytes: MAX_MODEL_BYTES },
  vendorBytes: (vendorManifest.files || []).reduce((sum, file) => sum + file.bytes, 0),
  totalBytes,
  maximumTotalBytes: MAX_TOTAL_BYTES,
  vendorNamespace: 'src/vendor/lifejacket',
};
fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
fs.writeFileSync(path.join(root, 'dist', 'lifejacket-assets.json'), `${JSON.stringify(report, null, 2)}\n`);
console.log(`Verified Lifejacket assets: ${totalBytes} bytes total; model sha256=${modelHash}`);
