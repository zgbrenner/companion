# Lifejacket Mode Design

**Date:** 2026-07-31

## Goal

Replace the retired Caveman Mode with a local, browser-native Lifejacket Mode that always runs an extractive LLMLingua-2-style compressor when prompt compression is enabled, while preserving the extension's privacy, explicit-preview, and fail-closed data boundaries.

## User experience

Lifejacket Mode has one master switch and three independently persisted child switches:

1. **Compress prompts locally**
2. **Ask for a shorter reply**
3. **Convert files to Markdown**

The master switch determines whether any Lifejacket behavior is active. Child preferences remain saved while the master switch is off. The in-page Lifejacket panel shows all four controls, model readiness, and file conversion only when that child feature is enabled.

A send is intercepted only when Lifejacket Mode is active and either prompt compression or reply brevity is enabled. The user sees a modal containing:

- the optimized prompt;
- the original prompt;
- measured character savings;
- model status and warnings;
- **Send optimized**, **Send original**, and **Cancel** controls.

Nothing is sent automatically. **Send original** bypasses every Lifejacket modification.

When reply brevity is enabled, this visible suffix is appended to the end of the optimized prompt:

> Reply briefly. Lead with the answer and keep every necessary fact, step, and caveat.

This replaces the old one-time instruction, reminder cadence, and per-conversation injection state.

## Model decision

Lifejacket uses `atjsh/llmlingua-2-js-mobilebert-meetingbank`, an ONNX MobileBERT token-classification checkpoint distilled for the LLMLingua-2 extractive-compression task.

Why MobileBERT:

- It is materially smaller and faster than the official BERT-base and XLM-R checkpoints.
- It preserves more model capacity than the TinyBERT alternative, whose own browser-port documentation explicitly describes lower accuracy.
- MobileBERT was designed for constrained-device inference, which fits an extension that must work on ordinary laptops without a server.
- The model is compatible with local Transformers.js and ONNX Runtime Web inference.

The release build downloads the exact 99,170,493-byte FP32 ONNX source whose SHA-256 is:

```text
caaadce5fa0fafce898c8ac2c152652a929ed5a2f55929eceb2f3325de4a2f07
```

It then performs deterministic dynamic INT8 quantization and writes `model_quantized.onnx`. The source model is never fetched at runtime. The extension ships the quantized model, tokenizer, configuration, local Transformers.js module, and local ONNX Runtime Web assets inside the Web Store ZIP.

The derivative checkpoint does not publish a rigorous MobileBERT-versus-TinyBERT quality evaluation. The build therefore treats model quality as a release gate rather than a marketing assumption. CI verifies protected-span preservation, compression bounds, golden-prompt behavior, FP32-versus-INT8 token-decision agreement, model provenance, and package-size limits.

## Runtime architecture

```text
Claude or ChatGPT composer
          │ explicit send attempt
          ▼
Lifejacket content script
  - reads only the active composer
  - protects exact spans
  - opens visible preview
          │ validated extension message
          ▼
Service worker router
  - validates origin, frame, size, and options
  - creates/reuses offscreen document
          │ extension-only message
          ▼
Offscreen Lifejacket runtime
  - remote models disabled
  - local WASM paths only
  - MobileBERT Q8 loaded once
  - token-preservation scoring
          │ compressed result or typed failure
          ▼
Visible preview
  - optimized / original / cancel
```

The existing offscreen document remains the privileged local-work host. File parsing continues in the separate opaque-origin sandbox. The ML model never receives file bytes directly. It receives only prompt text when the user attempts to send and prompt compression is enabled.

## Compression behavior

Lifejacket is extractive. It selects original word spans instead of paraphrasing them.

Before model inference, the core splits the prompt into compressible and protected spans. Protected spans include:

- fenced and inline code;
- URLs and email addresses;
- Markdown links;
- quoted strings;
- identifiers, dates, and number-bearing tokens;
- line-oriented JSON, YAML, shell commands, and table structures when detected.

Compressible text is sentence-chunked to MobileBERT's sequence limit. The model's class-1 probability is treated as the token's preservation score, matching LLMLingua-2's token-classification design. WordPiece probabilities are merged back onto exact original word spans, punctuation required for readable structure is retained, and the highest-scoring words are kept to a conservative default ratio of 0.65.

A result is rejected and the original is returned when any of these checks fail:

- a protected span is absent or reordered;
- the output is empty;
- more than 60 percent of non-whitespace characters were removed;
- the output is larger than the original;
- model inference exceeds the bounded timeout;
- the model or tokenizer cannot be loaded;
- the result contains a placeholder or malformed reconstruction.

Even when the result is rejected, the model was still invoked when compression was enabled. The safety gate decides whether its output is usable, not whether inference runs.

## Settings and migration

New settings:

```js
{
  lifejacketMode: false,
  showLifejacketMode: true,
  lifejacketPromptCompression: true,
  lifejacketReplyBrevity: true,
  lifejacketFileConversion: true,
  lifejacketKeepRatio: 0.65
}
```

Migration rules:

- `cavemanMode: true` becomes `lifejacketMode: true` when no Lifejacket master value exists.
- `showCavemanMode` becomes `showLifejacketMode` when no Lifejacket visibility value exists.
- all three child features default to on;
- legacy Caveman execution is forced off so its synchronous trimmer and instruction injector cannot race Lifejacket.

The old Caveman source may remain temporarily for migration history, but it is not loaded by the manifest and no user-visible copy uses the retired name.

## Security and privacy

- No developer backend.
- No runtime model download.
- No analytics or telemetry.
- Prompt and file contents are never persisted.
- Remote model loading is disabled in Transformers.js.
- ONNX Runtime WASM files are loaded only from the extension package.
- The service worker accepts compression only from allowed top-frame Claude and ChatGPT content scripts.
- Message text is size-bounded and responses are shape-validated.
- Model and vendor files are hash-inventoried during every build.
- The extension package contains no source maps, tests, development files, or remote executable code.

## CI/CD and release contract

Every pull request must pass:

- JavaScript syntax and manifest validation;
- Lifejacket settings, protection, reconstruction, and fallback unit tests;
- browser integration tests on Claude-like and ChatGPT-like composers;
- file-conversion regression tests;
- model source-integrity and quantization checks;
- FP32-versus-INT8 decision-agreement tests;
- package-size and no-remote-code audits;
- accessibility checks;
- dependency, secret, and CodeQL security checks.

A `v*` tag builds from source, vendors pinned dependencies, recreates the quantized model, runs the entire suite, creates a deterministic Web Store ZIP, generates SHA-256 checksums, SBOM and provenance files, uploads attestations, and publishes a GitHub Release. Chrome Web Store upload remains a protected optional job that runs only when its required secrets are configured.
