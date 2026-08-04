# Lifejacket Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Caveman Mode with a locally bundled, quantized MobileBERT LLMLingua-2 compressor and three independently controlled Lifejacket features, then ship it through reproducible CI/CD and release automation.

**Architecture:** A universal content script owns Lifejacket UI and composer interception for Claude and ChatGPT. A validated service-worker router delegates prompt compression to the existing offscreen document, where a local Transformers.js runtime keeps the quantized model warm. Build tooling vendors all runtime dependencies, pins and verifies the source model, generates the Q8 ONNX model, and produces provenance and package inventories.

**Tech Stack:** Chrome Manifest V3, plain JavaScript, Shadow DOM, Transformers.js 4.2.0, ONNX Runtime Web, Python 3.12, ONNX 1.22.0, ONNX Runtime 1.27.0, Playwright 1.61.1, axe-core 4.12.1, GitHub Actions.

## Global Constraints

- Product name is **Lifejacket Mode** everywhere visible.
- One master switch controls three independently persisted child switches.
- Prompt compression invokes the local model on every send attempt when its child switch is enabled.
- Reply-brevity text is appended visibly at the end of the optimized prompt.
- File conversion remains local and sandboxed.
- No prompt, reply, model input, or file content is persisted.
- No model, script, WASM file, or font is fetched at runtime.
- Compression failure must preserve the original prompt and must never auto-send.
- All user-facing transformations require a preview and explicit user action.
- Release packages are deterministic and independently checksum-verifiable.

---

### Task 1: Define Lifejacket settings and pure safety core

**Files:**
- Create: `src/lifejacket-settings.js`
- Create: `src/lifejacket-core.js`
- Test: `tests/19-lifejacket-core.mjs`

**Interfaces:**
- Produces: `globalThis.CompanionLifejacketSettings.merge(stored)`
- Produces: `globalThis.CompanionLifejacketCore.protectPrompt(text)`
- Produces: `globalThis.CompanionLifejacketCore.finalizeCompression(input)`
- Produces: `globalThis.CompanionLifejacketCore.appendReplySuffix(text, enabled)`

- [ ] **Step 1: Write failing settings and safety tests**

Cover legacy migration, independent child toggles, exact protected-span restoration, output-size bounds, empty-result fallback, suffix placement, and rejection of reordered protected spans.

- [ ] **Step 2: Run the focused test and confirm RED**

Run: `node tests/19-lifejacket-core.mjs`

Expected: failure because the Lifejacket globals do not exist.

- [ ] **Step 3: Implement the minimal pure modules**

The settings adapter wraps the existing shared settings merger without mutating stored prompt data. The safety core must remain dependency-free so it can be tested in a Node VM and reused by the content and offscreen layers.

- [ ] **Step 4: Run the focused test and confirm GREEN**

Run: `node tests/19-lifejacket-core.mjs`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lifejacket-settings.js src/lifejacket-core.js tests/19-lifejacket-core.mjs
git commit -m "feat: add Lifejacket settings and safety core"
```

### Task 2: Build and vendor the local quantized model runtime

**Files:**
- Create: `package.json`
- Create: `requirements-lifejacket-build.txt`
- Create: `tools/vendor-lifejacket-runtime.mjs`
- Create: `tools/build-lifejacket-model.py`
- Create: `tools/verify-lifejacket-assets.mjs`
- Create: `src/lifejacket-runtime.js`
- Create: `src/models/lifejacket/.gitkeep`
- Test: `tests/20-lifejacket-assets.mjs`

**Interfaces:**
- Produces: `src/vendor/transformers.web.min.js`
- Produces: `src/vendor/ort/*.{mjs,wasm}`
- Produces: `src/models/lifejacket/config.json`
- Produces: `src/models/lifejacket/tokenizer.json`
- Produces: `src/models/lifejacket/onnx/model_quantized.onnx`
- Produces: `src/models/lifejacket/provenance.json`
- Produces: `src/models/lifejacket/SHA256SUMS`

- [ ] **Step 1: Write the failing asset-contract test**

Assert exact pinned versions, expected build scripts, source model size and SHA, local-only runtime configuration, expected quantized filename, provenance fields, and package-size budgets.

- [ ] **Step 2: Run the focused test and confirm RED**

Run: `node tests/20-lifejacket-assets.mjs`

Expected: failure because the build toolchain and runtime do not exist.

- [ ] **Step 3: Implement dependency vendoring**

Install `@huggingface/transformers@4.2.0` with lifecycle scripts disabled. Copy only the browser ESM bundle, required ONNX Runtime Web modules and WASM binaries, and license files. Generate a SHA-256 inventory and reject remote executable references.

- [ ] **Step 4: Implement model download, verification, and Q8 build**

Download only from the pinned Hugging Face repository and revision. Verify the 99,170,493-byte source ONNX and SHA-256 `caaadce5fa0fafce898c8ac2c152652a929ed5a2f55929eceb2f3325de4a2f07`, dynamically quantize supported matrix weights to per-channel QUInt8, preserve the documented sensitive weights as FP16 with runtime casts, validate the output graph, copy tokenizer/config files, and write provenance plus checksums.

- [ ] **Step 5: Implement the offscreen inference runtime**

Disable remote models, point Transformers.js to packaged model and WASM directories, load `MobileBertPreTrainedModel` through a token-classification wrapper, score class-1 preservation probabilities, map WordPiece probabilities onto exact original word spans, and return a typed result.

- [ ] **Step 6: Build assets and confirm GREEN**

Run:

```bash
npm ci --ignore-scripts
npm run build:lifejacket
node tests/20-lifejacket-assets.mjs
```

Expected: PASS; quantized model below 35 MiB and complete Lifejacket runtime assets below 50 MiB.

- [ ] **Step 7: Commit source and reproducibility metadata only**

Generated model/vendor artifacts remain ignored in source control and are recreated in CI.

### Task 3: Add the validated background/offscreen compression route

**Files:**
- Create: `src/lifejacket-background.js`
- Modify: `src/service-worker.js`
- Modify: `src/offscreen.html`
- Test: `tests/21-lifejacket-routing.mjs`

**Interfaces:**
- Consumes: `cuc:lifejacket-compress`
- Produces: `{ ok, text, changed, savedPct, model, durationMs, warning }`
- Offscreen message: `cuc:lifejacket-compress-offscreen`

- [ ] **Step 1: Write the failing routing test**

Verify allowed top-frame origins, sender ID, text-size limits, keep-ratio bounds, timeout behavior, offscreen reuse, and rejection of forged or malformed messages.

- [ ] **Step 2: Run the focused test and confirm RED**

Run: `node tests/21-lifejacket-routing.mjs`

Expected: failure because the router is absent.

- [ ] **Step 3: Implement the service-worker router**

Use a serialized offscreen-creation promise, bounded request timeout, exact origin allowlist, top-frame validation, and response schema validation. Return a typed failure rather than throwing into the content script.

- [ ] **Step 4: Load the runtime from the offscreen page**

Keep the existing sandboxed file parser unchanged. Load the local Transformers.js module and Lifejacket runtime only in the privileged offscreen page.

- [ ] **Step 5: Run the focused test and confirm GREEN**

Run: `node tests/21-lifejacket-routing.mjs`

Expected: PASS.

### Task 4: Add the cross-provider Lifejacket panel and explicit preview

**Files:**
- Create: `src/lifejacket-content.js`
- Create: `src/lifejacket.css`
- Modify: `manifest.json`
- Test: `tests/22-lifejacket-browser.mjs`

**Interfaces:**
- Consumes: `CompanionLifejacketSettings`, `CompanionLifejacketCore`
- Sends: `cuc:lifejacket-compress`
- Persists: `cuc:settings`

- [ ] **Step 1: Write the failing browser test**

Exercise Claude-like and ChatGPT-like composers. Verify master and child controls, persistence, file-control visibility, model-loading state, send interception, suffix-at-end behavior, optimized/original/cancel actions, dark mode, focus handling, and no interception from unrelated editables.

- [ ] **Step 2: Run the focused test and confirm RED**

Run: `node tests/22-lifejacket-browser.mjs`

Expected: failure because the panel and manifest entries are absent.

- [ ] **Step 3: Implement the Shadow DOM panel**

Dock after the existing COMPANION provider widget when available, otherwise after the visual composer. Match provider width and page appearance without relying on page-global CSS.

- [ ] **Step 4: Implement safe asynchronous send interception**

Capture Enter and send-button clicks only inside the active composer. Open the preview immediately, run model compression in the offscreen document, show measured savings or fallback warning, and require an explicit send choice.

- [ ] **Step 5: Implement file conversion control**

Reuse `cuc:convert-file`, preserve the 20 MB and 800,000-character limits, and expose the picker/dropzone only when both the master and file-conversion child switch are enabled.

- [ ] **Step 6: Run the focused and existing browser suites**

Run:

```bash
node tests/22-lifejacket-browser.mjs
node tests/run.mjs
```

Expected: all PASS.

### Task 5: Replace Caveman settings and copy without rewriting the legacy options application

**Files:**
- Create: `src/options-lifejacket.html`
- Create: `src/options-lifejacket.js`
- Modify: `manifest.json`
- Test: `tests/23-lifejacket-options.mjs`

**Interfaces:**
- Wraps: `src/options.html`
- Persists: Lifejacket master visibility and child settings

- [ ] **Step 1: Write the failing options test**

Verify the options page contains no visible Caveman copy, exposes Lifejacket visibility and three child controls, persists them, handles restore-defaults, and keeps all existing provider settings usable.

- [ ] **Step 2: Run the focused test and confirm RED**

Run: `node tests/23-lifejacket-options.mjs`

Expected: failure because the wrapper does not exist.

- [ ] **Step 3: Implement the same-origin options wrapper**

Render the existing options page in a full-viewport, borderless same-origin frame. Rename and retarget the legacy visibility row after load, inject the three Lifejacket child switches using existing visual classes, and synchronize restore-defaults without modifying the large existing options implementation.

- [ ] **Step 4: Run options and accessibility tests**

Run:

```bash
node tests/23-lifejacket-options.mjs
node tests/05-a11y.mjs
```

Expected: PASS with no serious or critical violations.

### Task 6: Update packaging, documentation, and release version

**Files:**
- Modify: `tools/package-webstore.sh`
- Modify: `manifest.json`
- Modify: `README.md`
- Modify: `CHANGELOG.md`
- Create: `RELEASE_NOTES_1.3.0.md`
- Create: `docs/LIFEJACKET_MODE.md`
- Modify: `docs/SECURITY.md`
- Modify: `store/privacy-policy.md`
- Modify: `store/permission-justifications.md`
- Modify: `store/test-instructions.md`
- Test: `tests/24-lifejacket-release-contract.mjs`

**Interfaces:**
- Produces: `dist/companion-1.3.0.zip`
- Produces: ZIP checksum and package inventory

- [ ] **Step 1: Write the failing release-contract test**

Require version 1.3.0, no visible Caveman copy, packaged Q8 model and local runtime, notices/licenses, deterministic archive rules, and no runtime network model dependencies.

- [ ] **Step 2: Run the focused test and confirm RED**

Run: `node tests/24-lifejacket-release-contract.mjs`

Expected: failure on old version/copy/package rules.

- [ ] **Step 3: Update package builder and docs**

Require generated model/vendor inventories, include them under `src/`, reject unapproved model names and remote code patterns, calculate model/package size, and document privacy, latency, first-use loading, failure behavior, and exact model provenance.

- [ ] **Step 4: Build twice and compare hashes**

Run:

```bash
npm run build:extension
cp dist/companion-1.3.0.zip /tmp/companion-first.zip
npm run build:extension
cmp /tmp/companion-first.zip dist/companion-1.3.0.zip
```

Expected: byte-identical ZIPs.

### Task 7: Build extensive CI, security, model-quality, and release automation

**Files:**
- Modify: `.github/workflows/tests.yml`
- Modify: `.github/workflows/release-package.yml`
- Create: `.github/workflows/model-quality.yml`
- Create: `.github/workflows/security.yml`
- Create: `.github/dependabot.yml`
- Create: `.github/actions/build-extension/action.yml`
- Test: `tests/25-workflow-contract.mjs`

**Interfaces:**
- Reusable action outputs: `version`, `zip_path`, `checksum_path`, `model_hash`, `package_hash`
- Release artifacts: Web Store ZIP, checksums, SBOM, provenance, inventories, test transcript, model-quality report

- [ ] **Step 1: Write the failing workflow-contract test**

Require pinned major action versions, least-privilege permissions, concurrency, timeouts, dependency caches keyed by lockfiles and model hash, build/test/package jobs, artifact retention, CodeQL, dependency review, npm/pip audits, secret scanning, model-quality gates, SBOM, artifact attestation, and tag/version validation.

- [ ] **Step 2: Run the focused test and confirm RED**

Run: `node tests/25-workflow-contract.mjs`

Expected: failure because the new CI contract is absent.

- [ ] **Step 3: Implement the reusable build action**

Set up pinned Node and Python versions, install locked dependencies without lifecycle scripts, restore model/runtime caches, rebuild and verify Lifejacket assets, run syntax/static checks, and expose output paths and hashes.

- [ ] **Step 4: Expand pull-request CI**

Run pure unit tests before expensive model work, then browser/model/package matrices. Upload transcripts, screenshots, model reports, and package inventories even on failure.

- [ ] **Step 5: Add model-quality workflow**

Run on relevant pull requests, manual dispatch, and monthly schedule. Compare FP32 and Q8 keep/drop decisions on a committed prompt corpus, enforce protected-span invariants and conservative compression ranges, record latency, and fail when agreement or size budgets regress.

- [ ] **Step 6: Add security workflow**

Run CodeQL for JavaScript and Python, dependency review on pull requests, `npm audit`, `pip-audit`, Gitleaks, generated-asset malware/hash checks, manifest-permission checks, and remote-code scans.

- [ ] **Step 7: Replace release workflow**

On `v*` tags, validate tag equals manifest version, run all gates, create deterministic artifacts, generate CycloneDX SBOM and provenance, attest the ZIP, and publish the GitHub Release. Define an optional protected Chrome Web Store publishing job gated by configured secrets.

- [ ] **Step 8: Run all workflow-contract and local tests**

Run:

```bash
node tests/25-workflow-contract.mjs
node tests/run.mjs
```

Expected: all PASS.

### Task 8: Verify the branch through GitHub Actions and open the pull request

**Files:**
- Modify only files required by observed failures

- [ ] **Step 1: Push the completed branch**

- [ ] **Step 2: Inspect every triggered workflow**

Do not infer success from queued or skipped jobs. Read failed logs and patch the branch until required checks pass.

- [ ] **Step 3: Perform final package audit**

Verify the release candidate contains the model, tokenizer, local runtime, WASM files, licenses, manifest 1.3.0, and no tests, source maps, development dependencies, secrets, remote scripts, or unquantized model.

- [ ] **Step 4: Open a pull request into `main`**

The body must include model rationale, package-size delta, privacy boundary, migration behavior, test evidence, release instructions, and residual risks. Do not merge without an explicit user instruction.
