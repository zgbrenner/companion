# COMPANION Security and Privacy Architecture

**Version:** 1.4.1
**Last updated:** August 4, 2026

COMPANION is a Chrome Manifest V3 extension for supported Claude and ChatGPT web surfaces. It has no developer backend, account system, analytics, telemetry, advertising, or remote code.

This document describes the trust boundaries for Claude native usage reads, OpenAI numeric usage observation, the shared toolbar badge, Lifejacket Mode, local file conversion, browser storage, and the release supply chain.

## Security principles

1. **Least privilege.** Exact provider host permissions, no `<all_urls>`, and no broad `tabs` permission.
2. **Separate provider boundaries.** Claude and OpenAI use distinct adapters, messages, storage keys, and validation paths.
3. **No prompt or reply storage.** Conversation text is not persisted by COMPANION.
4. **No runtime code or model downloads.** JavaScript, WASM, tokenizer files, and Q8 weights ship inside the extension package.
5. **Fail closed.** Unsupported usage fields are omitted; unsafe compression returns the original prompt; parser failures leave the draft unchanged.
6. **Visible user control.** Lifejacket never silently sends a transformed prompt.
7. **Reproducible releases.** Sources, dependencies, package contents, checksums, SBOM, and provenance are gated in CI.

## Requested permissions

| Permission | Purpose | Boundary |
| --- | --- | --- |
| `storage` | Settings, bounded provider usage snapshots, Claude spend history, badge ownership, and migration state | Prompt, reply, and file contents are never stored |
| `activeTab` | Route the popup after explicit user interaction | No persistent broad tab history |
| `notifications` | Optional native-limit warnings | No message text in notifications |
| `offscreen` | Run bundled Q8/WASM inference and host the local document-conversion relay | Extension-owned page with validated messages |
| `alarms` | Expire stale usage and reconcile the shared badge | No content collection |

Host permissions are limited to:

- `https://claude.ai/*`
- `https://*.claude.ai/*`
- `https://chatgpt.com/*`
- `https://*.chatgpt.com/*`
- `https://chat.openai.com/*`

## Claude usage boundary

The Claude adapter makes read-only same-origin requests to recognized usage endpoints using the browser's existing signed-in session.

- COMPANION does not read or store the session cookie.
- Responses are schema-validated and reduced to recognized usage fields.
- Unexpected keys and malformed values are ignored.
- Claude and OpenAI state remain separate.
- Dollar values come from Claude's own usage-credit counter.
- Token figures are derived ranges and labeled accordingly.

## OpenAI page-world boundary

Some first-party numeric usage data is visible only in the page's JavaScript world. COMPANION uses two scripts with different privileges:

1. a manifest-declared `MAIN`-world observer sees first-party responses and immediately normalizes recognized bounded numeric fields;
2. an isolated content script receives only that normalized object over a random per-page event channel.

The isolated script and service worker validate extension identity, top-frame status, exact origin, message size, allowed keys, units, bucket names, ranges, timestamps, and expiry. Raw OpenAI responses and conversation text do not cross the bridge or enter extension storage.

## Shared badge boundary

Claude and OpenAI use separate usage adapters but one toolbar badge. A serialized badge owner records provider, level, source, and timestamp. A stale alarm or older provider update cannot clear a newer warning owned by another provider.

## Lifejacket Mode boundary

Lifejacket has a master switch and three independent child controls. New installations default to master off.

### Prompt interception

The content script intercepts only an unmodified Enter press in a recognized visible composer or a recognized send/submit button associated with that composer.

It does not intercept Shift+Enter, modified Enter, composition events, unrelated editable fields, subframes, or unsupported origins.

### Privileged message validation

The service worker accepts Lifejacket compression and file-conversion messages only when:

- `sender.id` matches `chrome.runtime.id`;
- `sender.frameId` is zero;
- the sender URL is HTTPS on an allowed Claude or ChatGPT origin;
- message type, size, file extension, and compression ratio pass validation.

Compression text is limited to 120,000 characters. File data is bounded before the offscreen relay receives it.

### Local model runtime

Lifejacket uses a bundled MobileBERT LLMLingua-2-style token classifier:

- pinned model revision and source SHA-256;
- dynamic per-channel QUInt8/Q8 weights with selective FP16 preservation for sensitive layers;
- local CPU/WASM execution on one thread;
- remote model loading disabled;
- no remote module imports;
- no provider API key;
- no prompt telemetry.

The offscreen page does not persist model input or output. It returns a candidate to the requesting content script for preview.

### Compression safeguards

Before compression, Lifejacket separates protected spans:

- fenced and inline code;
- Markdown links;
- URLs and email addresses;
- quoted strings;
- number-bearing tokens;
- JSON, YAML, table, and shell-like lines;
- negation, obligations, exceptions, and bounds.

A candidate is rejected when a protected span is missing, protected-span order changes, the candidate is empty or larger, retained non-whitespace content falls below 40%, or inference fails or times out.

The tokenizer `[UNK]` ratio is checked after model inference. A chunk with more than 20% unknown tokens remains unchanged and produces a visible warning. This avoids trusting scores computed mostly from unknown-token placeholders.

These controls reduce obvious semantic failures. They do not prove semantic equivalence because compression is inherently lossy.

### Review-before-send invariant

Lifejacket always presents an editable modal with **Send optimized**, **Send original**, and **Cancel**. A failed model request fills the preview with the original prompt. No fallback path silently submits.

### Reply-brevity instruction

The optional brevity sentence is visibly appended at the end of the final preview. It is never inserted into a hidden system message or private provider payload.

## File-to-Markdown sandbox

Markdown and text files are read directly by the isolated content script. Other supported formats are converted through an opaque-origin sandbox declared in `manifest.json`.

The sandbox has no `chrome.*` API access, extension-origin privileges, network access, provider-session access, or persistent storage. It receives one selected file's bytes and returns Markdown through `postMessage`. The privileged offscreen page reads the bundled parser and PDF worker, but untrusted document parsing occurs inside the sandbox.

Limits:

- 20 MB selected file;
- 800,000 inserted Markdown characters;
- no Optical Character Recognition;
- no extracted images.

## Stored data

### `chrome.storage.local`

May contain settings, Claude daily spend deltas, cached Claude account configuration, bounded OpenAI usage snapshots when session storage fallback is required, provider warning state, and migration metadata.

It does not contain prompt or reply text, file bytes, converted Markdown, model input/output, cookies, passwords, authentication tokens, API keys, or raw provider response payloads.

### `chrome.storage.session`

May contain ephemeral session-spend state, short-lived OpenAI numeric snapshots, and transient provider data. It clears when the browser session ends.

### Complete local reset

The Settings page clears local and session storage and removes the toolbar badge. Provider accounts, conversations, and server-side history are not touched.

## Content Security Policy

Extension pages allow only bundled scripts. `wasm-unsafe-eval` is present solely because ONNX Runtime Web must compile the bundled WASM binary. It does not permit remote JavaScript.

The extension-page policy permits scripts and workers from `'self'`, blocks blob-backed extension workers, blocks objects and foreign base URLs, restricts connections to the extension and exact provider origins, and does not include ordinary `'unsafe-eval'`. The file-conversion sandbox has its own opaque-origin policy for its isolated parser worker.

The separate parser sandbox permits the minimum script/WASM capabilities required by the vendored parser while denying network access.

## Runtime and model supply chain

The released extension does not install or execute the npm dependency graph of Transformers.js.

The build instead:

1. downloads two immutable npm tarballs at pinned URLs;
2. verifies exact SHA-512 Subresource Integrity values;
3. checks package name, version, and declared license;
4. extracts only the browser bundle and required ONNX Runtime WASM pair;
5. ships reviewed Apache-2.0 and MIT notices;
6. records file hashes in a vendor manifest.

The model build:

1. downloads from a pinned Hugging Face commit;
2. validates exact source size and SHA-256;
3. applies deterministic per-channel QUInt8 MatMul/Gemm quantization with explicitly documented FP16 preservation for sensitive weights;
4. runs ONNX structural validation;
5. enforces a 40 MiB model ceiling and 55 MiB generated-asset ceiling;
6. writes provenance and `SHA256SUMS`;
7. refuses to package the FP32 source.

## CI/CD security gates

Pull requests and releases use:

- locked `npm ci --ignore-scripts` installation;
- pinned Python build requirements;
- model and runtime integrity checks;
- complete Chromium extension tests;
- Q8-to-FP32 label agreement, ranking overlap, probability drift, latency, and size gates;
- deterministic ZIP reproduction;
- CodeQL extended security queries;
- GitHub dependency review;
- npm and Python dependency audits;
- Gitleaks history and diff scanning;
- forbidden-package-surface checks;
- CycloneDX SBOM generation;
- GitHub artifact provenance attestations.

Chrome Web Store API v2 publishing is optional and runs only in a protected GitHub environment. Authentication uses a short-lived Google service-account access token. The default path stages the package after review instead of immediately rolling it out.

## Known limitations

- Provider DOM and private response shapes can change.
- Native usage fields differ by account and plan.
- Compression is lossy and may remove context that safeguards do not recognize.
- The MobileBERT vocabulary is not equally strong across languages and domains.
- Browser CPU/WASM inference can be slower on low-end hardware, especially on first load.
- Local file conversion is not a malware scanner and does not perform OCR.

## Reporting a security issue

Do not include cookies, credentials, private prompts, account identifiers, or unredacted provider responses in a public issue. Send reproducible security reports to `zgbrenner@gmail.com` with the extension version, browser version, affected provider, and a minimal redacted reproduction.
