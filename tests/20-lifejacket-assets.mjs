import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');
const exists = relative => fs.existsSync(path.join(root, relative));

const pkg = JSON.parse(read('package.json'));
assert.equal(pkg.private, true);
assert.equal(pkg.type, 'module');
assert.equal(pkg.engines.node, '>=22.0.0');
assert.equal(pkg.devDependencies['@huggingface/transformers'], undefined, 'full Transformers dependency graph is not installed');
assert.equal(pkg.devDependencies['onnxruntime-web'], undefined, 'ONNX Runtime package graph is not installed');
assert.equal(pkg.scripts['build:lifejacket'], 'node tools/vendor-lifejacket-runtime.mjs && python3 tools/build-lifejacket-model.py && node tools/verify-lifejacket-assets.mjs');
assert.match(pkg.scripts['build:extension'], /build:lifejacket/);
assert.match(pkg.scripts['build:extension'], /package-webstore/);

const requirements = read('requirements-lifejacket-build.txt');
assert.match(requirements, /^onnx==1\.22\.0$/m);
assert.match(requirements, /^onnxruntime==1\.27\.0$/m);
assert.match(requirements, /^tokenizers==0\.21\.4$/m);
assert.doesNotMatch(requirements, />=|~=|\^|\*/);

const builder = read('tools/build-lifejacket-model.py');
assert.match(builder, /atjsh\/llmlingua-2-js-mobilebert-meetingbank/);
assert.match(builder, /900ed52628d7b153a276a220483d26d5f8dfe0f7/);
assert.match(builder, /99170493/);
assert.match(builder, /caaadce5fa0fafce898c8ac2c152652a929ed5a2f55929eceb2f3325de4a2f07/);
assert.match(builder, /QuantType\.QInt8/);
assert.match(builder, /model_quantized\.onnx/);
assert.match(builder, /provenance\.json/);
assert.match(builder, /SHA256SUMS/);

const vendor = read('tools/vendor-lifejacket-runtime.mjs');
assert.match(vendor, /@huggingface\/transformers/);
assert.match(vendor, /4\.2\.0/);
assert.match(vendor, /1\.26\.0-dev\.20260416-b7804b056c/);
assert.match(vendor, /sha512-8BRCoBMH0XsWaEIamuR0LrJGAfftgHAfb2Vrffy0VKlSAE\/MnUJ5\/h\/zTfEP3fDIft\+nk7TqB8xXEyABGitBjQ==/);
assert.match(vendor, /sha512-MD6Ss4GSpQBo6zqoJzyT9LRbKYs7x\/JVN23FT24EcEvlqF4VuzPOeH6X38orZPKHQDbprn7K\+SBpu0\/mj2CQiw==/);
assert.match(vendor, /runtime-packages/);
assert.match(vendor, /installsPackageDependencies:\s*false/);
assert.match(vendor, /src['"],\s*['"]vendor['"],\s*['"]lifejacket['"]/);
assert.match(vendor, /transformers\.web\.min\.js/);
assert.match(vendor, /ort-wasm/);
assert.match(vendor, /vendor-manifest\.json/);
assert.match(vendor, /allowRemoteModels/);
assert.match(vendor, /officeparser\.browser\.slim\.iife\.js/);
assert.match(vendor, /pdf\.worker\.min\.mjs/);

const runtime = read('src/lifejacket-runtime.js');
assert.match(runtime, /env\.allowRemoteModels\s*=\s*false/);
assert.match(runtime, /env\.allowLocalModels\s*=\s*true/);
assert.match(runtime, /env\.localModelPath/);
assert.match(runtime, /src\/vendor\/lifejacket\/ort\//);
assert.match(runtime, /AutoModelForTokenClassification/);
assert.match(runtime, /dtype:\s*['"]q8['"]/);
assert.match(runtime, /cuc:lifejacket-compress-offscreen/);
assert.match(runtime, /\.\/vendor\/lifejacket\/transformers\.web\.min\.js/);
assert.doesNotMatch(runtime, /https?:\/\//);

assert.ok(exists('src/models/lifejacket/.gitkeep'));
assert.ok(exists('src/vendor/officeparser.browser.slim.iife.js'));
assert.ok(exists('src/vendor/pdf.worker.min.mjs'));
assert.ok(exists('third_party/licenses/onnxruntime-MIT.txt'));

if (process.env.REQUIRE_LIFEJACKET_ASSETS === '1') {
  const model = path.join(root, 'src/models/lifejacket/onnx/model_quantized.onnx');
  const provenancePath = path.join(root, 'src/models/lifejacket/provenance.json');
  const sumsPath = path.join(root, 'src/models/lifejacket/SHA256SUMS');
  const transformer = path.join(root, 'src/vendor/lifejacket/transformers.web.min.js');
  const vendorManifest = path.join(root, 'src/vendor/lifejacket/vendor-manifest.json');
  const ortLicense = path.join(root, 'src/vendor/lifejacket/licenses/onnxruntime-MIT.txt');
  for (const file of [model, provenancePath, sumsPath, transformer, vendorManifest, ortLicense]) {
    assert.ok(fs.existsSync(file), `required generated asset missing: ${path.relative(root, file)}`);
    assert.ok(fs.statSync(file).size > 0, `generated asset is empty: ${path.relative(root, file)}`);
  }
  const modelBytes = fs.statSync(model).size;
  assert.ok(modelBytes < 35 * 1024 * 1024, `Q8 model exceeds 35 MiB: ${modelBytes}`);
  const provenance = JSON.parse(fs.readFileSync(provenancePath, 'utf8'));
  assert.equal(provenance.source.repository, 'atjsh/llmlingua-2-js-mobilebert-meetingbank');
  assert.equal(provenance.source.revision, '900ed52628d7b153a276a220483d26d5f8dfe0f7');
  assert.equal(provenance.source.onnx.sha256, 'caaadce5fa0fafce898c8ac2c152652a929ed5a2f55929eceb2f3325de4a2f07');
  const hash = crypto.createHash('sha256').update(fs.readFileSync(model)).digest('hex');
  assert.equal(provenance.output.onnx.sha256, hash);
  assert.equal(provenance.output.onnx.bytes, modelBytes);
  const generatedVendor = JSON.parse(fs.readFileSync(vendorManifest, 'utf8'));
  assert.equal(generatedVendor.policy.installsPackageDependencies, false);
  assert.equal(generatedVendor.licenses['onnxruntime-web'], 'MIT');
  const ortFiles = fs.readdirSync(path.join(root, 'src/vendor/lifejacket/ort')).filter(name => /\.wasm$/.test(name));
  assert.ok(ortFiles.length > 0, 'at least one local ONNX Runtime WASM binary is packaged');
}

console.log('PASS  Lifejacket model/runtime asset contract');
