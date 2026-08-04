# COMPANION v1.3.0

## ChatGPT first-class hardening

COMPANION v1.3.0 makes ChatGPT Chat and Work web support a first-class, privacy-preserving path alongside the existing Claude integration.

The core accuracy rule remains:

> Native numbers or nothing.

COMPANION displays numeric usage only when the provider exposes a supported native value. It does not estimate missing limits, infer account quotas, or scrape message text.

## What changed

- Recognizes the native OpenAI rate-limit shape used by ChatGPT, including primary and secondary windows and numeric Unix-second or Unix-millisecond reset timestamps.
- Preserves exact native token counters and renders native credit balances separately from usage.
- Keeps Chat and Work context aligned between the page widget and toolbar popup, including when the popup is opened from a routed surface.
- Applies one freshness policy consistently: fresh, aging, stale, and expired readings are labeled, and expired values are hidden instead of flashing as current.
- Expands composer detection for current ChatGPT layouts and resets the local new-conversation fallback key when a new chat is started.
- Bounds page-world response reads and normalized numeric values before they cross into the extension.
- Keeps same-provider toolbar badge updates monotonic and leaves the shared badge API behind the serialized owner.
- Adds regression coverage for the native response shape, balance-only responses, popup routing, stale badge ordering, and browser rendering.

## Surface boundaries

- ChatGPT Chat on the web: supported.
- ChatGPT Work on the web: supported when enabled for the account or workspace.
- Legacy Codex-aware web route detection remains for compatibility with routes that expose it, but it is not a claim that the current ChatGPT web product offers a selectable Codex surface.
- The standalone native Codex desktop application cannot host a Chrome content script and is outside the extension's injection boundary.
- Claude.ai support and the local Caveman Mode, prompt-trimming preview, and file-to-Markdown sandbox remain available.

## Privacy and safety

- No account, backend, analytics, telemetry, advertising, or tracking is added.
- Raw OpenAI response bodies stay in the page world. Only bounded normalized numeric fields and a query-free pathname cross the private channel.
- Prompts, replies, files, cookies, profile fields, and URL query values are not stored or sent to the developer.
- Unsupported, malformed, stale, or implausibly future values fail closed.

## Verification

The release candidate is covered by the numbered Chromium suite, including extension boot, settings, popup routing, accessibility, Claude and ChatGPT rendering, OpenAI bridge privacy, native usage and freshness behavior, local-data reset, badge ownership and restart recovery, brand assets, font integrity, package reproducibility, and release readiness.

Install the ZIP and checksum from the `release-package` GitHub Actions artifact, or build the deterministic Web Store package with `tools/package-webstore.sh`.
