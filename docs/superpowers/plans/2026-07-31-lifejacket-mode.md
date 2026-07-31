# Lifejacket Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Caveman Mode with a local, model-backed Lifejacket Mode whose prompt compression, reply brevity, and file-to-Markdown capabilities are independently controllable and fully covered by a reproducible release pipeline.

**Architecture:** A provider-neutral content-script controller sends bounded compression requests through a validated service-worker router to a lazy-loaded INT8 MobileBERT token classifier in the existing offscreen document. The model and browser runtime are built and bundled locally from pinned sources; no runtime network or native helper is introduced.

**Tech Stack:** Chrome Manifest V3, plain JavaScript, Node.js 22, `@huggingface/transformers`, ONNX Runtime WebAssembly, Python ONNX quantization tooling, Playwright, axe-core, GitHub Actions.

## Global Constraints

- Product name is exactly `Lifejacket Mode` in user-visible copy.
- Lifejacket has one master switch and three independently stored booleans: prompt compression, reply brevity, and file-to-Markdown.
- The compressor is called for every send while master mode and prompt compression are enabled.
- Reply-brevity text is appended to the end of the outgoing user message, never prepended.
- Prompt, reply, and file content is never persisted or sent to a COMPANION service.
- Runtime model downloads and remote code are forbidden.
- Existing exact provider host permissions remain unchanged.
- The file parser remains inside its opaque-origin, no-network sandbox.
- Production package version is `1.3.0`.
- Model source is `atjsh/llmlingua-2-js-mobilebert-meetingbank` at revision `900ed52628d7b153a276a220483d26d5f8dfe0f7`.
- Source ONNX size is `99,170,493` bytes and SHA-256 is `c33a76be25c33cad53bed70c404a1cc22142af36ee6cbb865277afc3ec548797`.

---

## File map

**Create**

- `src/lifejacket-settings.js`: defaults and legacy settings migration.
- `src/lifejacket.js`: provider-neutral controller, suffix instructions, background compression client.
- `src/lifejacket-background.js`: validated message router and offscreen lifecycle.
- `src/lifejacket-runtime.js`: local token-classification inference and extractive reconstruction.
- `model/lifejacket-model.lock.json`: pinned model source and integrity contract.
- `tools/build-extension.mjs`: assemble local browser runtime assets.
- `tools/build-lifejacket-model.py`: verify source model and emit INT8 ONNX.
- `tools/verify-lifejacket-assets.mjs`: audit generated runtime/model assets.
- `package.json` and `package-lock.json`: pinned reproducible build dependencies.
- `tests/19-lifejacket-settings.mjs`: defaults, migration, and manifest contract.
- `tests/20-lifejacket-controller.mjs`: every-send model call, suffix, and fail-open contract.
- `tests/21-lifejacket-runtime.mjs`: local-only runtime and CSP contract.
- `tests/22-lifejacket-build.mjs`: model lock, package, and workflow contract.
- `.github/workflows/codeql.yml`: JavaScript security analysis.
- `.github/workflows/dependency-review.yml`: pull-request dependency gate.
- `.github/workflows/release.yml`: tag-driven build, reproducibility, attestation, and GitHub Release.
- `.github/dependabot.yml`: pinned dependency update policy.
- `RELEASE_NOTES_1.3.0.md`: release notes.
- `THIRD_PARTY_NOTICES.md`: runtime and model provenance.

**Modify**

- `manifest.json`: version, scripts, CSP, and local runtime resources.
- `src/service-worker.js`: import Lifejacket background router.
- `src/offscreen.html`: load the offscreen service as a module.
- `src/offscreen.js`: retain conversion relay and add lazy model service.
- `src/content.js`: Lifejacket UI, independent capabilities, async preview, suffix behavior.
- `src/openai-content.js`: same provider-neutral Lifejacket behavior for ChatGPT surfaces.
- `src/background.js` and `src/openai-background.js`: remove provider-specific Caveman claim routers after migration.
- `src/options.html`, `src/options.js`, `src/options.css`: dedicated Lifejacket settings section.
- `src/widget.css`, `src/openai-widget.css`: Lifejacket states, status, and accessible controls.
- `tools/package-webstore.sh`: generated-asset validation and dynamic version audit.
- `.github/workflows/tests.yml`: build assets before the complete suite and split verification jobs.
- `.github/workflows/release-package.yml`: remove hard-coded versioning and use the common build.
- `tests/07-openai-manifest.mjs`, `tests/09-openai-widget.mjs`, and affected brand/accessibility tests: new product contract.
- `tests/README.md`, `README.md`, `CHANGELOG.md`, `docs/SECURITY.md`, and store materials: Lifejacket behavior and model boundary.

**Delete**

- `src/caveman.js` after `src/lifejacket.js` is loaded everywhere.

---

### Task 1: Define failing Lifejacket contracts

**Files:**
- Create: `tests/19-lifejacket-settings.mjs`
- Create: `tests/20-lifejacket-controller.mjs`
- Create: `tests/21-lifejacket-runtime.mjs`
- Create: `tests/22-lifejacket-build.mjs`

**Interfaces:**
- Consumes: existing manifest, shared settings, service-worker, offscreen, package, and workflow files.
- Produces: executable contracts for all later tasks.

- [ ] **Step 1: Write settings and manifest contract tests**

Assert that `lifejacket-settings.js` and `lifejacket.js` load before provider content scripts, Caveman is absent from shipped script arrays, all five Lifejacket booleans have defined defaults, and legacy Caveman settings migrate without surviving in merged output.

- [ ] **Step 2: Write controller contract tests**

Run `src/lifejacket.js` in a VM with a stubbed `chrome.runtime.sendMessage`. Call `compressPrompt()` twice, including a short prompt, and assert two `cuc:lifejacket-compress` requests. Assert a rejected request returns the original with `failed: true`. Assert `appendReplyInstruction()` leaves the user text first and the instruction last.

- [ ] **Step 3: Write runtime and build-policy tests**

Assert local-only model configuration, `q8` dtype, `wasm-unsafe-eval`, offscreen compression routing, exact model lock values, generated-asset verification, dynamic release versioning, SBOM, CodeQL, dependency review, and artifact attestation.

- [ ] **Step 4: Open a draft pull request and run the suite**

Run: `node tests/run.mjs`

Expected: tests 19-22 fail because Lifejacket production files and build contracts do not exist.

- [ ] **Step 5: Commit**

```bash
git add tests/19-lifejacket-settings.mjs tests/20-lifejacket-controller.mjs tests/21-lifejacket-runtime.mjs tests/22-lifejacket-build.mjs
git commit -m "test: define Lifejacket Mode contracts"
```

### Task 2: Add settings schema and migration

**Files:**
- Create: `src/lifejacket-settings.js`
- Modify: `manifest.json`
- Modify: `src/options.html`
- Modify: `src/options.js`
- Test: `tests/19-lifejacket-settings.mjs`

**Interfaces:**
- Consumes: `globalThis.ClaudeUsageCompanion.DEFAULT_SETTINGS` and `mergeSettings`.
- Produces: `lifejacketMode`, `showLifejacketMode`, `lifejacketPromptCompression`, `lifejacketReplyBrevity`, and `lifejacketFileConversion` on every merged settings object.

- [ ] **Step 1: Run the focused test and confirm RED**

Run: `node tests/19-lifejacket-settings.mjs`

Expected: failure reporting missing Lifejacket scripts/settings.

- [ ] **Step 2: Implement the migration adapter**

Extend defaults without duplicating shared logic. Wrap `mergeSettings` so legacy `cavemanMode` and `showCavemanMode` values are applied only when the new keys are absent, then delete both legacy keys from the returned object.

- [ ] **Step 3: Add Settings controls**

Add a Lifejacket navigation link and card with accessible switches for visibility, master state, prompt compression, reply brevity, and file conversion. Include every new boolean in `BOOLEAN_SETTINGS`.

- [ ] **Step 4: Run the focused test and settings browser test**

Run: `node tests/19-lifejacket-settings.mjs && node tests/02-settings.mjs`

Expected: both pass with no page errors.

- [ ] **Step 5: Commit**

```bash
git add manifest.json src/lifejacket-settings.js src/options.html src/options.js src/options.css tests/19-lifejacket-settings.mjs
git commit -m "feat: add Lifejacket settings and migration"
```

### Task 3: Implement the provider-neutral controller

**Files:**
- Create: `src/lifejacket.js`
- Delete: `src/caveman.js`
- Modify: `manifest.json`
- Test: `tests/20-lifejacket-controller.mjs`

**Interfaces:**
- Produces: `globalThis.CompanionLifejacket.compressPrompt(text, options)`, `appendReplyInstruction(text, kind)`, `LIFEJACKET_REPLY_INSTRUCTION`, `LIFEJACKET_REPLY_REMINDER`, and `LIFEJACKET_REMINDER_EVERY_N_RESPONSES`.

- [ ] **Step 1: Run the controller test and confirm RED**

Run: `node tests/20-lifejacket-controller.mjs`

Expected: missing `src/lifejacket.js`.

- [ ] **Step 2: Implement bounded async compression requests**

Validate text, send `cuc:lifejacket-compress`, validate the returned object, calculate measured savings, and fail open to the original prompt on error or timeout.

- [ ] **Step 3: Implement visible end-appended instructions**

`appendReplyInstruction(text, "instruction")` must return `${text}\n\n${LIFEJACKET_REPLY_INSTRUCTION}`. The reminder variant follows the same order.

- [ ] **Step 4: Run the focused test**

Run: `node tests/20-lifejacket-controller.mjs`

Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add manifest.json src/lifejacket.js src/caveman.js tests/20-lifejacket-controller.mjs
git commit -m "feat: add Lifejacket controller"
```

### Task 4: Add validated background and offscreen inference routing

**Files:**
- Create: `src/lifejacket-background.js`
- Modify: `src/service-worker.js`
- Modify: `src/offscreen.html`
- Modify: `src/offscreen.js`
- Modify: `manifest.json`
- Test: `tests/21-lifejacket-runtime.mjs`

**Interfaces:**
- Content request: `{type: "cuc:lifejacket-compress", text, options}`.
- Offscreen request: `{type: "cuc:offscreen-compress", requestId, text, options}`.
- Response: `{ok, text, originalChars, compressedChars, savedPct, model, backend, failed, warning}`.

- [ ] **Step 1: Run the runtime test and confirm RED**

Run: `node tests/21-lifejacket-runtime.mjs`

Expected: missing router/runtime and CSP contract.

- [ ] **Step 2: Implement sender and payload validation**

Allow only top-frame content scripts from exact Claude and ChatGPT origins, cap text at 200,000 characters, cap keep rate to 0.5-0.9, and use a 30-second timeout. Reject unexpected keys and non-string input.

- [ ] **Step 3: Reuse the existing offscreen lifecycle**

Create the offscreen document only when absent. Preserve the existing conversion route. Convert `offscreen.js` to a module and lazy-import the Lifejacket runtime only for compression.

- [ ] **Step 4: Add the permitted local WASM CSP**

Add `'wasm-unsafe-eval'` to extension-page `script-src` and a local/blob worker policy. Do not add network sources.

- [ ] **Step 5: Run the focused test**

Run: `node tests/21-lifejacket-runtime.mjs`

Expected: routing and local-only policy assertions pass.

- [ ] **Step 6: Commit**

```bash
git add manifest.json src/service-worker.js src/lifejacket-background.js src/offscreen.html src/offscreen.js tests/21-lifejacket-runtime.mjs
git commit -m "feat: route local Lifejacket inference"
```

### Task 5: Build and implement the INT8 MobileBERT runtime

**Files:**
- Create: `src/lifejacket-runtime.js`
- Create: `model/lifejacket-model.lock.json`
- Create: `tools/build-lifejacket-model.py`
- Create: `tools/build-extension.mjs`
- Create: `tools/verify-lifejacket-assets.mjs`
- Create: `package.json`
- Create: `package-lock.json`
- Test: `tests/21-lifejacket-runtime.mjs`
- Test: `tests/22-lifejacket-build.mjs`

**Interfaces:**
- `compressLifejacketPrompt(text, options)` returns the background response schema.
- Generated model path: `src/models/lifejacket/onnx/model_q8.onnx`.
- Generated runtime path: `src/vendor/transformers/transformers.web.js` plus local WASM siblings.

- [ ] **Step 1: Run build contracts and confirm RED**

Run: `node tests/22-lifejacket-build.mjs`

Expected: missing model lock/build scripts/package metadata.

- [ ] **Step 2: Add exact source integrity metadata**

Record repo, revision, source path, source size, source SHA-256, required tokenizer/config paths, selected quantization format, and output path.

- [ ] **Step 3: Implement deterministic source fetch and quantization**

Download revision-pinned URLs, verify every declared source, quantize MatMul/Gemm weights to signed INT8 with pinned ONNX Runtime tooling, emit the q8 model, and write a generated-asset manifest containing output hashes and sizes.

- [ ] **Step 4: Assemble the browser runtime locally**

Copy the browser build and required WASM files from pinned npm dependencies. Reject source maps, remote imports, and unexpected runtime files.

- [ ] **Step 5: Implement extractive inference**

Load the local tokenizer and q8 model with remote access disabled. Chunk at 128 model tokens, run token classification, apply stable softmax, merge `##` continuations, score words, preserve protected spans/numbers/punctuation, select by percentile, and reconstruct without paraphrasing. Return the original if compression grows the prompt or removes more than the conservative safety bound.

- [ ] **Step 6: Run build, audit, and model smoke test**

Run:

```bash
npm ci
npm run build
npm run verify:assets
npm run test:model
```

Expected: source integrity verified, q8 model loads under WASM, fixed fixture compresses while retaining required names/numbers, and no network access occurs.

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json model src/lifejacket-runtime.js tools tests/21-lifejacket-runtime.mjs tests/22-lifejacket-build.mjs
git commit -m "feat: bundle quantized Lifejacket compressor"
```

### Task 6: Integrate Lifejacket into Claude and ChatGPT surfaces

**Files:**
- Modify: `src/content.js`
- Modify: `src/openai-content.js`
- Modify: `src/widget.css`
- Modify: `src/openai-widget.css`
- Modify: `src/background.js`
- Modify: `src/openai-background.js`
- Modify: `tests/09-openai-widget.mjs`

**Interfaces:**
- Consumes: `CompanionLifejacket` controller and five migrated settings.
- Produces: master/child UI states and provider send behavior.

- [ ] **Step 1: Update the ChatGPT integration test to Lifejacket and confirm RED**

Seed all Lifejacket booleans, press Enter, assert a local compression preview, choose send, and assert the prompt precedes the visible brevity suffix. Toggle prompt compression off and assert the next send bypasses inference while retaining the suffix.

- [ ] **Step 2: Replace Caveman state and copy**

Rename user-visible controls, data attributes, modal labels, storage maps, and accessibility descriptions. Retain legacy storage reading only in migration code.

- [ ] **Step 3: Implement independent capability gates**

Intercept only when master mode is enabled and prompt compression or reply brevity is enabled. Await model compression when enabled. If only brevity is enabled, preserve the prompt and append the suffix without invoking compression. Show the file picker only when master mode and file conversion are enabled.

- [ ] **Step 4: Remove standalone instruction turns**

Do not send a message merely because the master switch was turned on. Append the full instruction to the next outgoing user message and reminders to later messages.

- [ ] **Step 5: Run provider and browser tests**

Run: `node tests/06-platforms.mjs && node tests/08-openai-network.mjs && node tests/09-openai-widget.mjs`

Expected: all pass without console or page errors.

- [ ] **Step 6: Commit**

```bash
git add src/content.js src/openai-content.js src/widget.css src/openai-widget.css src/background.js src/openai-background.js tests/09-openai-widget.mjs
git commit -m "feat: integrate Lifejacket across providers"
```

### Task 7: Expand CI, security, and release automation

**Files:**
- Modify: `.github/workflows/tests.yml`
- Modify: `.github/workflows/release-package.yml`
- Create: `.github/workflows/codeql.yml`
- Create: `.github/workflows/dependency-review.yml`
- Create: `.github/workflows/release.yml`
- Create: `.github/dependabot.yml`
- Modify: `tools/package-webstore.sh`
- Test: `tests/22-lifejacket-build.mjs`

**Interfaces:**
- Produces: pull-request quality gates, tag-driven release assets, provenance, and optional protected Web Store publication.

- [ ] **Step 1: Split pull-request verification into focused jobs**

Add static policy, dependency install, model build/cache, unit/browser tests, model smoke, package audit, and reproducibility jobs. Upload logs, generated-asset manifest, screenshots, and package inventory on failure and success as appropriate.

- [ ] **Step 2: Add security workflows**

Run CodeQL for JavaScript/TypeScript on pushes, pull requests, and a weekly schedule. Run dependency review on pull requests with moderate-or-higher severity failure. Configure Dependabot for npm and GitHub Actions.

- [ ] **Step 3: Make packaging version-independent and model-aware**

Derive version from `manifest.json`, require q8 model/runtime assets, reject FP32 ONNX and remote model references, and keep deterministic timestamps/order/permissions.

- [ ] **Step 4: Add tag-driven release workflow**

Verify tag/version, build assets, run complete tests, package twice, compare hashes, generate CycloneDX/SPDX SBOM, generate checksums and inventory, attest the package, create the GitHub Release, and upload every release artifact.

- [ ] **Step 5: Add optional Web Store publication**

Use a protected `chrome-web-store` environment and required secrets. Skip cleanly when secrets are absent or publication input is false.

- [ ] **Step 6: Run workflow and package contract tests**

Run: `node tests/22-lifejacket-build.mjs`

Expected: pass.

- [ ] **Step 7: Commit**

```bash
git add .github tools/package-webstore.sh tests/22-lifejacket-build.mjs
git commit -m "ci: add reproducible Lifejacket release pipeline"
```

### Task 8: Update product, security, and release documentation

**Files:**
- Modify: `README.md`
- Modify: `CHANGELOG.md`
- Modify: `docs/SECURITY.md`
- Modify: `store/privacy-policy.md`
- Modify: `store/listing.md`
- Modify: `store/permission-justifications.md`
- Modify: `store/test-instructions.md`
- Create: `RELEASE_NOTES_1.3.0.md`
- Create: `THIRD_PARTY_NOTICES.md`
- Modify: `tests/README.md`

**Interfaces:**
- Produces: accurate public explanation of local model inference, package size, first-use latency, controls, provenance, and failure behavior.

- [ ] **Step 1: Replace public Caveman references**

Use Lifejacket Mode consistently, except in a clearly labeled migration note.

- [ ] **Step 2: Document the model boundary honestly**

State that prompts are processed locally in the offscreen extension context, the model is bundled, no model CDN is contacted, first inference can be slower while WASM/model assets initialize, and failures preserve the original prompt.

- [ ] **Step 3: Add third-party provenance and licenses**

List LLMLingua-2 research/upstream model, the MobileBERT conversion source, Transformers.js, ONNX Runtime, tokenizer/runtime libraries, pinned revisions, and license texts or links required by their licenses.

- [ ] **Step 4: Update release notes and test instructions**

Describe independent toggles, package footprint, model initialization, test cases, and upgrade migration.

- [ ] **Step 5: Commit**

```bash
git add README.md CHANGELOG.md docs/SECURITY.md store RELEASE_NOTES_1.3.0.md THIRD_PARTY_NOTICES.md tests/README.md
git commit -m "docs: document Lifejacket Mode and local model"
```

### Task 9: Full verification and merge readiness

**Files:**
- Review: all changed files.

**Interfaces:**
- Produces: verified pull request and release candidate.

- [ ] **Step 1: Run clean dependency and build verification**

```bash
rm -rf node_modules src/models/lifejacket src/vendor/transformers dist
npm ci
npm run build
npm run verify:assets
```

Expected: exit 0 with pinned hashes and no untracked source-model binary.

- [ ] **Step 2: Run the complete extension suite**

Run: `node tests/run.mjs`

Expected: every numbered test passes, including browser and accessibility coverage.

- [ ] **Step 3: Run deterministic packaging twice**

```bash
npm run package
cp dist/companion-1.3.0.zip /tmp/companion-first.zip
npm run package
cmp /tmp/companion-first.zip dist/companion-1.3.0.zip
sha256sum -c dist/companion-1.3.0.zip.sha256
```

Expected: `cmp` exits 0 and checksum verification passes.

- [ ] **Step 4: Inspect package inventory and permissions**

Confirm only `manifest.json`, `icons/`, and `src/` exist at the ZIP root; q8 assets exist; FP32 ONNX, source maps, tests, docs, secrets, and remote scripts do not.

- [ ] **Step 5: Review the pull-request diff against the design**

Check every requirement in the design document and record any remaining limitation in the pull-request body rather than guessing.

- [ ] **Step 6: Mark the pull request ready and merge only after required checks pass**

Use squash merge with a release-focused commit title. Create tag `v1.3.0` only after the merge commit is on `main`.