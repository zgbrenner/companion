# COMPANION 1.3.0

## Lifejacket Mode

COMPANION 1.3.0 replaces the previous prompt-efficiency experience with **Lifejacket Mode**, a local, review-before-send safety net for Claude and ChatGPT web composers.

Lifejacket has one master switch and three independently saved controls:

- **Shorten the user's prompt** with a bundled MobileBERT LLMLingua-2-style Q8 compressor.
- **Ask for shorter answers** by adding one visible brevity instruction at the end of the final prompt.
- **Convert files to Markdown** locally before inserting the result into the current draft.

The master switch can be turned off without losing the three child preferences.

## Local Q8 prompt compression

The release bundles a pinned, dynamically quantized INT8 checkpoint built from `atjsh/llmlingua-2-js-mobilebert-meetingbank` at revision `900ed52628d7b153a276a220483d26d5f8dfe0f7`.

Measured release values:

- verified FP32 source: 99,170,493 bytes;
- packaged Q8 ONNX model: 39,411,097 bytes;
- size reduction: 60.3%;
- runtime: local CPU/WASM through Transformers.js and ONNX Runtime Web;
- runtime model downloads: none.

When compression is enabled, the model runs before every supported non-empty send. Lifejacket may intentionally return the original prompt when the candidate is unsafe or not useful.

## Review and fallback behavior

Before anything is sent, Lifejacket opens an editable preview with:

- **Send optimized**
- **Send original**
- **Cancel**

Code, URLs, email addresses, quotations, numbers, structured rows, negation, obligations, and bounds receive conservative protection. A result is rejected when protected content disappears or changes order, the prompt becomes larger, too much content is removed, model coverage is poor, or inference fails.

Prompts with weak tokenizer coverage are not guessed at. The model is invoked, low-coverage chunks remain unchanged, and the preview explains why.

## Reply brevity is separate

The optional reply instruction is appended visibly to the end of the final prompt:

> Reply briefly. Lead with the answer and keep every necessary fact, step, and caveat.

Prompt compression can be off while reply brevity remains on, and vice versa.

## Local file conversion

Lifejacket supports PDF, Office, OpenDocument, RTF, CSV, HTML, Markdown, and text files.

- Markdown and text are read locally in the page-isolated extension script.
- Other formats use the existing opaque-origin parser sandbox.
- Converted Markdown is appended to the existing draft.
- Files are limited to 20 MB and inserted text to 800,000 characters.
- Optical Character Recognition is not included.

## Privacy and security

- No COMPANION account, backend, analytics, or telemetry.
- No prompt, reply, or file-content storage.
- No runtime model or executable-code downloads.
- No new provider host permissions.
- Top-frame and origin validation on privileged routes.
- Original prompt preserved on compression failure.
- Existing document parser dependencies isolated from the model build.
- The release carries applicable Apache-2.0 and MIT notices.

## Build and release automation

The 1.3.0 release pipeline now includes:

- locked npm and Python build dependencies;
- pinned model and runtime source hashes;
- reproducible Q8 model generation;
- real Chromium extension tests on Claude and ChatGPT-style surfaces;
- Q8-to-FP32 fidelity, ranking, probability-drift, latency, and size gates;
- deterministic Chrome Web Store ZIP reproduction;
- CodeQL, dependency review, npm audit, Python audit, and secret scanning;
- package inventory, checksums, and CycloneDX SBOM;
- GitHub build-provenance attestations;
- GitHub Release automation;
- optional protected Chrome Web Store API v2 upload and staged publishing.

## Upgrade behavior

Existing prompt-efficiency settings migrate once:

- the prior master setting becomes the Lifejacket master setting;
- the prior visibility setting becomes the Lifejacket visibility setting;
- all three new child tools default to on;
- the retired runtime is disabled to prevent two send interceptors from competing.

Lifejacket remains off by default for new installations. Users must turn it on explicitly.

## Verification

Run the complete local test suite after generating the pinned model/runtime assets:

```bash
npm ci --ignore-scripts
python3 -m pip install -r requirements-lifejacket-build.txt
npm run build:lifejacket
npx playwright install chromium
node tests/run.mjs
bash tools/package-webstore.sh
```

See `docs/LIFEJACKET_MODE.md` for architecture, limitations, provenance, and failure behavior.
