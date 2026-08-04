# COMPANION 1.4.0

COMPANION 1.4.0 combines the Lifejacket implementation with the ChatGPT-first provider work and ships the release candidate from the reconciled mainline.

## ChatGPT web support

- Supports ChatGPT Chat and Work surfaces with native usage, token, credit, freshness, and reset handling when OpenAI exposes trustworthy numeric fields.
- Keeps ChatGPT context and toolbar routing aligned, with narrow compatibility for legacy Codex web routes.
- Bounds page-world reads and normalized numbers, keeps provider badge updates monotonic, and resets new-chat fallback state correctly.

## Lifejacket Mode

- Adds a local, review-before-send workflow for prompt compression, shorter replies, and file-to-Markdown conversion on Claude and ChatGPT web composers.
- Protects code, URLs, email addresses, quoted text, numbers, structured rows, and semantic guard words; unsafe or unhelpful candidates fail open to the original prompt.
- Keeps model inference local with remote model loading disabled and limits queued model work to protect ordinary laptops.
- Fixes settings-page wiring so the visible Lifejacket controls persist correctly without the retired Caveman anchor.

## Model and release integrity

- Builds the pinned MobileBERT checkpoint from the verified `atjsh/llmlingua-2-js-mobilebert-meetingbank` revision.
- Uses per-channel QUInt8 quantization with selective FP16 preservation for sensitive layers, passing the release quality gate: 0.9842 label agreement, 0.9940 ranking overlap, 0.0123 probability MAE, and 55 ms p95 local CPU latency.
- Ships a 40,312,452-byte Q8 model below the 40 MiB ceiling, with hashes for every copied model metadata file and deterministic provenance/checksums.
- Hardens vendored runtime downloads with HTTPS registry pinning, redirect rejection, bounded streaming, exclusive temporary files, and isolated generated assets.
- Keeps reproducible packaging, SBOM/provenance, security checks, and Chrome Web Store review assets in the release workflow.

Nothing is silently submitted, provider values are never estimated, and prompts, replies, files, and raw provider payloads remain local to the extension workflow.
