// Reproducible build/release contract for bundled Lifejacket inference assets.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { EXT_PATH, assert } from "./lib.mjs";

function read(relative) {
  const path = join(EXT_PATH, ...relative.split("/"));
  assert(existsSync(path), `${relative} exists`);
  return readFileSync(path, "utf8");
}

const lock = JSON.parse(read("model/lifejacket-model.lock.json"));
assert(lock.source?.repo === "atjsh/llmlingua-2-js-mobilebert-meetingbank", "model source repository is pinned");
assert(lock.source?.revision === "900ed52628d7b153a276a220483d26d5f8dfe0f7", "model source revision is pinned");
assert(lock.source?.onnx?.path === "onnx/model.onnx", "source ONNX path is explicit");
assert(lock.source?.onnx?.size === 99170493, "source ONNX byte size is pinned");
assert(lock.source?.onnx?.sha256 === "c33a76be25c33cad53bed70c404a1cc22142af36ee6cbb865277afc3ec548797",
  "source ONNX SHA-256 is pinned");
assert(lock.output?.path === "src/models/lifejacket/onnx/model_q8.onnx", "only the q8 model is the package output");
assert(lock.output?.dtype === "q8", "release model dtype is q8");
assert(Array.isArray(lock.source?.requiredFiles) && lock.source.requiredFiles.includes("tokenizer.json"),
  "tokenizer source is part of the integrity contract");

const packageJson = JSON.parse(read("package.json"));
assert(packageJson.engines?.node === "22.x", "Node 22 build floor is explicit");
for (const script of ["build", "build:model", "build:runtime", "verify:assets", "test", "test:model", "package"]) {
  assert(typeof packageJson.scripts?.[script] === "string", `package script ${script} exists`);
}
assert(packageJson.devDependencies?.["@huggingface/transformers"], "Transformers.js is pinned as a build dependency");
assert(packageJson.devDependencies?.onnxruntime, "ONNX Runtime tooling is pinned for model quantization");

const buildModel = read("tools/build-lifejacket-model.py");
for (const required of ["lifejacket-model.lock.json", "sha256", "quantize_dynamic", "QInt8", "model_q8.onnx"]) {
  assert(buildModel.includes(required), `model build verifies or emits ${required}`);
}
assert(!/resolve\/main/.test(buildModel), "model build never follows a mutable main branch");

const buildExtension = read("tools/build-extension.mjs");
for (const required of ["@huggingface/transformers", "transformers.web.js", "ort-wasm", "lifejacket-model.lock.json"]) {
  assert(buildExtension.includes(required), `extension build assembles ${required}`);
}
const verifyAssets = read("tools/verify-lifejacket-assets.mjs");
assert(verifyAssets.includes("model_q8.onnx"), "asset audit requires the q8 model");
assert(verifyAssets.includes("model.onnx"), "asset audit explicitly rejects or checks the FP32 source model");
assert(verifyAssets.includes("http://") && verifyAssets.includes("https://"), "asset audit scans generated code for remote URLs");

const packageScript = read("tools/package-webstore.sh");
assert(packageScript.includes("verify-lifejacket-assets"), "Web Store packaging audits generated Lifejacket assets");
assert(packageScript.includes("model_q8.onnx"), "Web Store package requires the q8 model");
assert(!packageScript.includes("manifest.get('version') != '1.2.0'"), "packaging is not hard-coded to v1.2.0");

const testsWorkflow = read(".github/workflows/tests.yml");
for (const required of ["npm ci", "npm run build", "npm run test:model", "REQUIRE_LIFEJACKET_ASSETS", "reproduc"]) {
  assert(testsWorkflow.toLowerCase().includes(required.toLowerCase()), `tests workflow includes ${required}`);
}

const releaseWorkflow = read(".github/workflows/release.yml");
for (const required of [
  "push:",
  "tags:",
  "npm ci",
  "npm run build",
  "node tests/run.mjs",
  "cmp ",
  "sbom",
  "attest-build-provenance",
  "softprops/action-gh-release",
  "chrome-web-store",
]) {
  assert(releaseWorkflow.includes(required), `release workflow includes ${required}`);
}
assert(releaseWorkflow.includes("manifest.json"), "release verifies the manifest version against the tag");

const codeql = read(".github/workflows/codeql.yml");
assert(codeql.includes("github/codeql-action"), "CodeQL workflow uses GitHub's analyzer");
const dependencyReview = read(".github/workflows/dependency-review.yml");
assert(dependencyReview.includes("actions/dependency-review-action"), "dependency review gates pull requests");
const dependabot = read(".github/dependabot.yml");
assert(dependabot.includes("npm") && dependabot.includes("github-actions"), "Dependabot covers npm and Actions");

console.log("22-lifejacket-build PASS");
