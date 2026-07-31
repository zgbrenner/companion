import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');
const exists = relative => fs.existsSync(path.join(root, relative));

for (const file of [
  'package-lock.json',
  '.github/actions/build-extension/action.yml',
  '.github/workflows/tests.yml',
  '.github/workflows/model-quality.yml',
  '.github/workflows/security.yml',
  '.github/workflows/release-package.yml',
  '.github/dependabot.yml',
  'tools/evaluate-lifejacket-model.py',
  'tests/fixtures/lifejacket-prompts.json',
]) {
  assert.ok(exists(file), `CI dependency exists: ${file}`);
}

const action = read('.github/actions/build-extension/action.yml');
assert.match(action, /runs:\s*\n\s*using:\s*["']?composite/i);
assert.match(action, /actions\/setup-node@v4/);
assert.match(action, /actions\/setup-python@v5/);
assert.match(action, /npm ci --ignore-scripts/);
assert.match(action, /requirements-lifejacket-build\.txt/);
assert.match(action, /build:lifejacket/);
for (const output of ['version', 'zip_path', 'checksum_path', 'model_hash', 'package_hash']) {
  assert.match(action, new RegExp(`\\b${output}:`), `build action exposes ${output}`);
}

const testsWorkflow = read('.github/workflows/tests.yml');
assert.match(testsWorkflow, /permissions:\s*\n\s*contents:\s*read/);
assert.match(testsWorkflow, /concurrency:/);
assert.match(testsWorkflow, /timeout-minutes:/g);
assert.match(testsWorkflow, /\.\/\.github\/actions\/build-extension/);
assert.match(testsWorkflow, /\.cache\/lifejacket/);
assert.match(testsWorkflow, /package-lock\.json/);
assert.match(testsWorkflow, /REQUIRE_LIFEJACKET_ASSETS/);
assert.match(testsWorkflow, /node tests\/run\.mjs/);
assert.match(testsWorkflow, /actions\/upload-artifact@v4/);

const modelWorkflow = read('.github/workflows/model-quality.yml');
assert.match(modelWorkflow, /schedule:/);
assert.match(modelWorkflow, /workflow_dispatch:/);
assert.match(modelWorkflow, /pull_request:/);
assert.match(modelWorkflow, /evaluate-lifejacket-model\.py/);
assert.match(modelWorkflow, /lifejacket-prompts\.json/);
assert.match(modelWorkflow, /agreement/i);
assert.match(modelWorkflow, /latency/i);
assert.match(modelWorkflow, /actions\/upload-artifact@v4/);

const securityWorkflow = read('.github/workflows/security.yml');
assert.match(securityWorkflow, /github\/codeql-action\/init@v3/);
assert.match(securityWorkflow, /github\/codeql-action\/analyze@v3/);
assert.match(securityWorkflow, /actions\/dependency-review-action@v4/);
assert.match(securityWorkflow, /npm audit/);
assert.match(securityWorkflow, /pip-audit/);
assert.match(securityWorkflow, /gitleaks/i);
assert.match(securityWorkflow, /permissions:/);
assert.match(securityWorkflow, /timeout-minutes:/g);

const release = read('.github/workflows/release-package.yml');
assert.match(release, /tags:\s*\n\s*-\s*["']v\*["']/);
assert.match(release, /workflow_dispatch:/);
assert.match(release, /manifest\.json/);
assert.match(release, /GITHUB_REF_NAME|github\.ref_name/);
assert.match(release, /build-extension/);
assert.match(release, /attest-build-provenance@v2/);
assert.match(release, /id-token:\s*write/);
assert.match(release, /attestations:\s*write/);
assert.match(release, /contents:\s*write/);
assert.match(release, /SBOM|sbom/i);
assert.match(release, /gh release create|softprops\/action-gh-release/);
assert.match(release, /chrome-web-store/i);
assert.match(release, /CHROME_WEB_STORE_EXTENSION_ID/);
assert.match(release, /environment:\s*\n?\s*name:\s*chrome-web-store|environment:\s*chrome-web-store/);

const dependabot = read('.github/dependabot.yml');
for (const ecosystem of ['npm', 'pip', 'github-actions']) {
  assert.match(dependabot, new RegExp(`package-ecosystem:\s*["']${ecosystem}["']`));
}
assert.match(dependabot, /interval:\s*["']weekly["']/);

console.log('PASS  extensive Lifejacket CI, model-quality, security, and release workflow contract');
