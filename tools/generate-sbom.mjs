import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const readJson = relative => JSON.parse(fs.readFileSync(path.join(root, relative), 'utf8'));
const sha256 = relative => crypto.createHash('sha256').update(fs.readFileSync(path.join(root, relative))).digest('hex');

const manifest = readJson('manifest.json');
const lock = readJson('package-lock.json');
const provenance = readJson('src/models/lifejacket/provenance.json');
const vendor = readJson('src/vendor/lifejacket/vendor-manifest.json');
const components = [];

function add(component) {
  if (!component?.name || !component?.version || !component?.['bom-ref']) return;
  if (components.some(existing => existing['bom-ref'] === component['bom-ref'])) return;
  components.push(component);
}

add({
  type: 'application',
  name: 'COMPANION',
  version: manifest.version,
  'bom-ref': `pkg:chrome/companion@${encodeURIComponent(manifest.version)}`,
  description: manifest.description,
  properties: [
    { name: 'companion:manifest-version', value: String(manifest.manifest_version) },
    { name: 'companion:minimum-chrome-version', value: String(manifest.minimum_chrome_version) },
  ],
});

for (const [location, metadata] of Object.entries(lock.packages || {})) {
  if (!location.startsWith('node_modules/') || !metadata?.version) continue;
  const name = location.slice('node_modules/'.length);
  add({
    type: 'library',
    name,
    version: metadata.version,
    'bom-ref': `pkg:npm/${name.replace(/^@/, '%40')}@${encodeURIComponent(metadata.version)}`,
    purl: `pkg:npm/${name.replace(/^@/, '%40')}@${encodeURIComponent(metadata.version)}`,
    scope: metadata.dev ? 'optional' : 'required',
    hashes: metadata.integrity ? [{ alg: 'SHA-512', content: metadata.integrity.replace(/^sha512-/, '') }] : undefined,
    licenses: metadata.license ? [{ license: { id: metadata.license } }] : undefined,
    properties: [{ name: 'companion:npm-location', value: location }],
  });
}

const requirements = fs.readFileSync(path.join(root, 'requirements-lifejacket-build.txt'), 'utf8')
  .split(/\r?\n/)
  .map(line => line.trim())
  .filter(line => line && !line.startsWith('#'));
for (const requirement of requirements) {
  const match = /^([A-Za-z0-9_.-]+)==([^\s;]+)$/.exec(requirement);
  if (!match) throw new Error(`Unpinned Python requirement cannot enter the SBOM: ${requirement}`);
  const [, name, version] = match;
  add({
    type: 'library',
    name,
    version,
    'bom-ref': `pkg:pypi/${name.toLowerCase()}@${encodeURIComponent(version)}`,
    purl: `pkg:pypi/${name.toLowerCase()}@${encodeURIComponent(version)}`,
    scope: 'optional',
    properties: [{ name: 'companion:purpose', value: 'reproducible Lifejacket model build' }],
  });
}

const modelRelative = provenance.output.onnx.path.startsWith('src/')
  ? provenance.output.onnx.path
  : `src/models/lifejacket/${provenance.output.onnx.path}`;
add({
  type: 'machine-learning-model',
  name: provenance.source.repository,
  version: provenance.source.revision,
  'bom-ref': `pkg:huggingface/${provenance.source.repository}@${provenance.source.revision}?file=${encodeURIComponent(provenance.output.onnx.path)}`,
  hashes: [{ alg: 'SHA-256', content: sha256(modelRelative) }],
  properties: [
    { name: 'companion:model-architecture', value: provenance.model.architecture },
    { name: 'companion:model-compression-method', value: provenance.model.compression_method },
    { name: 'companion:model-dtype', value: provenance.model.dtype },
    { name: 'companion:source-model-sha256', value: provenance.source.onnx.sha256 },
    { name: 'companion:source-revision', value: provenance.source.revision },
  ],
});

for (const [name, version] of Object.entries(vendor.packages || {})) {
  const encoded = name.replace(/^@/, '%40');
  add({
    type: 'library',
    name,
    version,
    'bom-ref': `pkg:npm/${encoded}@${encodeURIComponent(version)}?bundled=true`,
    purl: `pkg:npm/${encoded}@${encodeURIComponent(version)}`,
    scope: 'required',
    properties: [
      { name: 'companion:bundled', value: 'true' },
      { name: 'companion:vendor-namespace', value: vendor.policy.namespace },
    ],
  });
}

components.sort((left, right) => left['bom-ref'].localeCompare(right['bom-ref']));
const serialSeed = JSON.stringify({ version: manifest.version, components: components.map(component => component['bom-ref']) });
const serial = crypto.createHash('sha256').update(serialSeed).digest('hex');
const document = {
  bomFormat: 'CycloneDX',
  specVersion: '1.6',
  serialNumber: `urn:uuid:${serial.slice(0, 8)}-${serial.slice(8, 12)}-${serial.slice(12, 16)}-${serial.slice(16, 20)}-${serial.slice(20, 32)}`,
  version: 1,
  metadata: {
    component: components.find(component => component.name === 'COMPANION'),
    tools: {
      components: [{ type: 'application', name: 'companion-generate-sbom', version: '1.0.0' }],
    },
    properties: [
      { name: 'companion:reproducible', value: 'true' },
      { name: 'companion:generated-from', value: 'package-lock.json, pinned Python requirements, model provenance, vendor manifest' },
    ],
  },
  components: components.filter(component => component.name !== 'COMPANION'),
};

const output = path.join(root, 'dist', `companion-${manifest.version}.cdx.json`);
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, `${JSON.stringify(document, null, 2)}\n`, 'utf8');
console.log(`Wrote ${path.relative(root, output)} with ${document.components.length} components.`);
