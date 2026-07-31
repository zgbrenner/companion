# Lifejacket Mode Design

## Objective

Replace Caveman Mode with **Lifejacket Mode**, a local, privacy-first efficiency layer for supported Claude and ChatGPT web composers. Lifejacket Mode has one master switch and three independently configurable capabilities:

1. **Prompt compression** using a bundled, quantized LLMLingua-2-style token classifier.
2. **Shorter replies** through a visible instruction appended to the end of the outgoing user message.
3. **File-to-Markdown conversion** through the existing no-network conversion boundary.

A user can enable or disable each capability while Lifejacket Mode is off. Child settings remain dormant until the master switch is on.

## Model decision

Use `atjsh/llmlingua-2-js-mobilebert-meetingbank`, pinned to revision `900ed52628d7b153a276a220483d26d5f8dfe0f7`, as the source checkpoint. The upstream ONNX file is `99,170,493` bytes with SHA-256 `c33a76be25c33cad53bed70c404a1cc22142af36ee6cbb865277afc3ec548797`.

The release build converts the source model to signed INT8 ONNX and bundles only the quantized result. MobileBERT is selected instead of TinyBERT because an always-on compressor needs a better accuracy floor, while MobileBERT remains materially smaller than BERT-base and is designed for constrained-device inference. The official BERT-base LLMLingua-2 checkpoint is rejected for the extension because its browser package and working-set cost are disproportionate.

The release package must contain the model, tokenizer, Transformers.js browser runtime, and ONNX Runtime WebAssembly files. Runtime downloads and remote code are forbidden.

## Architecture

### Content-script controller

`src/lifejacket.js` exposes a small, provider-neutral API:

- `compressPrompt(text, options)` requests local model inference and returns a structured result.
- `appendReplyInstruction(text, kind)` appends the full instruction or reminder to the end of the message.
- constants for the full instruction, reminder, and reminder interval.

The controller never stores prompt text. It validates every background response and fails open to the original prompt if inference is unavailable. A compression failure is shown in the preview rather than silently substituting the old regex compressor.

### Background router

`src/lifejacket-background.js` is imported by the composite service worker. It validates sender identity, top-frame status, exact supported origin, message schema, input length, and option bounds. It creates the offscreen document when needed and forwards a bounded compression request.

Provider-specific content scripts never call a localhost service and never receive access to model files.

### Offscreen inference host

The existing offscreen document becomes a module host for two local services:

- file-conversion relay to the opaque-origin parser sandbox;
- lazy-loaded Lifejacket model inference.

`src/lifejacket-runtime.js` loads the pinned local model and local Transformers.js runtime once, then reuses the model across sends. It uses the WASM backend and `q8` weights so WebGPU is not required. Remote models and remote WASM are disabled.

Inference is extractive. It scores token importance, merges WordPiece continuations into words, preserves protected spans, keeps required punctuation and numeric identifiers, selects words by a conservative percentile threshold, and reconstructs text without paraphrasing.

### Settings migration

`src/lifejacket-settings.js` extends the shared defaults and wraps shared settings migration. It maps:

- `cavemanMode` to `lifejacketMode`;
- `showCavemanMode` to `showLifejacketMode`.

The three new child settings default to enabled. Legacy keys are accepted only as migration input and are not written back.

## User experience

The widget shows a Lifejacket Mode master switch. When on, it shows the three capability states and the file picker only when file conversion is enabled.

The Settings page has a dedicated Lifejacket section with switches for:

- show Lifejacket Mode in supported widgets;
- master Lifejacket Mode state;
- compress prompts;
- request shorter replies;
- convert files to Markdown.

When prompt compression is enabled, every outgoing prompt is sent through the local model, including short prompts. The preview shows the compressed prompt, original prompt, measured character savings, model status, and any fail-open warning. The user can send the compressed prompt, edit it, send the original, or cancel.

When prompt compression is disabled but shorter replies are enabled, the original prompt is preserved and the visible brevity instruction is appended at send time. The instruction is never prepended. It is sent once per conversation, with a short reminder after twelve assistant responses where the provider integration can observe that count.

File conversion remains an explicit user action. Converted content is inserted into the composer and is not automatically sent.

## Privacy and security boundaries

- No COMPANION backend, telemetry, analytics, or model CDN.
- No prompt, reply, file, or model-input persistence.
- No new host permissions.
- Exact supported provider origins only.
- Model source revision, source hash, generated model hash, runtime versions, and licenses are recorded in release artifacts.
- The opaque-origin parser sandbox remains isolated from extension storage and provider sessions.
- Inference failures return the original prompt and a bounded error message.
- Maximum prompt size and inference timeout prevent unbounded offscreen work.

## Build and release design

The repository gains a pinned Node toolchain, deterministic asset assembly, source-model verification, INT8 quantization, model smoke tests, package reproducibility checks, SBOM generation, dependency review, CodeQL, artifact attestation, and tag-driven GitHub Releases.

A release must:

1. verify the manifest version matches the `v*` tag;
2. download only the pinned model revision;
3. verify source file size and SHA-256 before quantization;
4. build local browser runtime assets;
5. quantize and smoke-test the model;
6. run the complete numbered extension suite and accessibility checks;
7. build the Web Store ZIP twice and prove byte-for-byte reproducibility;
8. audit permissions, CSP, package roots, forbidden files, remote-code patterns, and model provenance;
9. generate checksums, package inventory, SBOM, and provenance metadata;
10. attach release assets to a GitHub Release.

Chrome Web Store publication is an optional protected-environment job. It must require explicit repository secrets and must not run for pull requests.

## Testing strategy

The test suite covers settings migration, independent toggles, message suffix placement, model-call behavior on every enabled send, fail-open behavior, local-only runtime configuration, pinned model provenance, package contents, provider send interception, UI accessibility, deterministic packaging, and a real quantized-model smoke fixture.

The first implementation commit contains failing contract tests. Production changes follow only after those tests demonstrate the missing behavior.