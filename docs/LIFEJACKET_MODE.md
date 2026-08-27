# Lifejacket Mode

Lifejacket Mode is COMPANION's local prompt-efficiency layer for supported Claude and ChatGPT web composers.

It has one master switch and three independently saved child controls:

1. **Shorten the user's prompt** with a bundled quantized LLMLingua-2-style token classifier.
2. **Ask for shorter answers** by appending one visible instruction to the end of the final prompt.
3. **Convert files to Markdown** locally before inserting the result into the composer.

Lifejacket is optional. Turning off the master switch disables all three tools without erasing the child preferences.

## Compressor selected for v1.4.0 and unchanged in v1.4.1

| Property | Pinned value |
| --- | --- |
| Model repository | `atjsh/llmlingua-2-js-mobilebert-meetingbank` |
| Revision | `900ed52628d7b153a276a220483d26d5f8dfe0f7` |
| Architecture | `MobileBERTForTokenClassification` |
| Compression method | LLMLingua-2 extractive token classification |
| Source ONNX size | 99,170,493 bytes |
| Source ONNX SHA-256 | `caaadce5fa0fafce898c8ac2c152652a929ed5a2f55929eceb2f3325de4a2f07` |
| Packaged model | Dynamic per-channel `QUInt8` with selective FP16-preserved weights, exposed to Transformers.js as `Q8` |
| Measured packaged size | 40,312,452 bytes |
| Runtime | Transformers.js 4.2.0 and ONNX Runtime Web |
| Execution provider | Local CPU/WASM, one thread |

The Q8 model is 59.4% smaller than the pinned FP32 source. The release gate fails if it reaches 40 MiB, which leaves roughly 3.9% growth above the measured output. The final encoder layer, classifier, and layer-22 bottleneck output retain FP16 weights and cast them to FP32 at runtime; this preserves multilingual fidelity while keeping the graph compatible with the local browser runtime.

MobileBERT was selected because it provides a substantially smaller browser package than the larger BERT and multilingual LLMLingua-2 checkpoints while retaining the same token-classification task shape. The choice is practical, not magical: an English-oriented MobileBERT vocabulary has weaker coverage for some scripts and specialized text. Lifejacket measures that coverage for every chunk and keeps low-coverage chunks unchanged.

## What happens before send

```text
User presses Send
        │
        ▼
Lifejacket intercepts the supported composer submission
        │
        ├─ protects code, URLs, email addresses, quotations, numbers,
        │  structured rows, negation, obligations, and bounds
        │
        ├─ invokes the bundled Q8 model on each unprotected text chunk
        │
        ├─ retains the configured share of the highest-scoring words
        │
        ├─ restores protected spans byte-for-byte and in original order
        │
        ├─ appends the optional reply-brevity instruction at the end
        │
        ▼
Visible preview
        ├─ Send optimized
        ├─ Send original
        └─ Cancel
```

Nothing is silently submitted. The preview remains editable.

## The compressor really runs when enabled

When prompt compression is enabled, Lifejacket invokes the local quantized model for every non-empty supported send, including prompts whose protected spans ultimately make compression unhelpful. It does not quietly substitute the retired rule-based shortener.

Lifejacket may still return the original prompt. That is a safety result, not a bypass. It happens when:

- the model found no worthwhile reduction;
- the candidate became larger;
- more than 60% of non-whitespace content would be removed;
- a protected span disappeared or changed order;
- model vocabulary coverage was too low for one or more chunks;
- model loading, inference, or validation failed.

## Protected content

Lifejacket extracts and restores sensitive spans before accepting a compressed result:

- fenced and inline code;
- URLs and email addresses;
- Markdown links;
- quoted strings;
- tokens containing numbers, including dates, amounts, identifiers, and versions;
- JSON, YAML, tables, and shell-like lines;
- semantic guard words such as `not`, `never`, `without`, `unless`, `except`, `only`, `must`, `shall`, `at least`, and `at most`.

This does not prove that every compressed prompt is semantically identical. Compression is inherently lossy. It reduces the most obvious failure modes and keeps the original prompt one click away.

## Low language-coverage behavior

The tokenizer's `[UNK]` ratio is calculated after model inference. When more than 20% of a chunk's usable tokens are unknown:

1. the Q8 model has still been invoked;
2. that chunk is kept unchanged;
3. the preview displays a coverage warning;
4. other adequately covered chunks may still be compressed.

This is particularly important for scripts and domain vocabularies that the MobileBERT checkpoint does not represent well.

## Reply brevity

The separate reply control appends this exact instruction to the end of the final prompt:

> Reply briefly. Lead with the answer and keep every necessary fact, step, and caveat.

It is visible in the preview, added once, and never hidden in a provider request. Turning prompt compression off does not turn reply brevity off.

## File-to-Markdown conversion

Supported formats:

- PDF
- DOCX, PPTX, XLSX
- ODT, ODP, ODS
- RTF
- CSV
- HTML and HTM
- Markdown and plain text

Markdown and text files are read directly in the content script. Other supported formats are parsed in the existing manifest-declared opaque-origin sandbox. The sandbox has no network access, extension API access, provider session access, or persistent file storage.

Limits:

- selected file: 20 MB;
- inserted Markdown: 800,000 characters;
- Optical Character Recognition is not performed in the extension.

Converted Markdown is appended to the current draft instead of replacing it.

## Local-only packaging

The released extension contains:

- the Q8 ONNX model;
- tokenizer and model configuration;
- the audited Transformers.js browser bundle;
- the required ONNX Runtime Web WASM pair;
- applicable Apache-2.0 and MIT license notices;
- provenance and checksums.

Lifejacket never downloads model weights or executable code at runtime. `env.allowRemoteModels` is set to `false`, remote module imports are rejected during packaging, and generated assets are checked against pinned hashes.

The build downloads immutable source artifacts only in CI or a developer build:

- the model files are fetched from the pinned Hugging Face commit and checked by size and SHA-256;
- the browser runtime tarballs are fetched from pinned npm URLs and checked by SHA-512 Subresource Integrity values;
- package dependencies from those tarballs are not installed or shipped.

## Failure behavior

Lifejacket fails closed with respect to transformation:

- a compressor error returns the original prompt;
- a file parser error leaves the existing draft unchanged;
- a timeout surfaces an error instead of sending automatically;
- an invalid or forged sender is rejected;
- subframes cannot invoke privileged compression or file-conversion routes;
- the preview always offers **Send original** and **Cancel**.

## Release quality gates

Every release candidate must pass:

- pure protected-span and settings-migration tests;
- real Chromium tests on simulated Claude and ChatGPT composer surfaces;
- local file-conversion tests;
- Q8-to-FP32 label agreement, ranking overlap, probability-drift, latency, and size gates;
- deterministic package reproduction;
- package inventory and checksum verification;
- CodeQL, dependency review, npm audit, Python dependency audit, and secret scanning;
- CycloneDX SBOM generation;
- GitHub artifact provenance attestation.

The Q8 comparison is a quantization-fidelity test. It shows whether quantization materially changed the pinned checkpoint. It does not treat the FP32 checkpoint as semantic ground truth.

## Privacy summary

Prompt text and file contents are processed only inside the installed extension. They are not sent to COMPANION, its developer, a telemetry service, or a model-hosting service. The provider receives only the prompt the user explicitly chooses to send.
