# Security and Privacy

This document describes Companion's security architecture, data handling, permissions, network behavior, threat model, and audit steps. Companion is an unofficial Manifest V3 extension for Claude.ai and ChatGPT web surfaces, including Chat, Work, and Codex-aware routes.

## Security summary

- All first-party code ships unminified and reviewable.
- There is no Companion server, analytics SDK, telemetry endpoint, remote logger, or tracker.
- Host access is limited to exact Claude and ChatGPT HTTPS origins.
- The extension uses `activeTab`, not the broad `tabs` permission.
- Provider access is read-only.
- Prompt and reply text are never persisted or transmitted by Companion.
- User-selected files are converted locally in an opaque-origin sandbox with no extension API access and no network access.
- Raw OpenAI account responses never cross from the page world into the extension.

## 1. Data handling

| Data | Read? | Stored locally? | Sent off-device by Companion? |
| --- | --- | --- | --- |
| Prompt text | Transiently, only for an optional local Caveman preview | No | No |
| Claude or ChatGPT reply text | No | No | No |
| User-selected file contents | Parsed locally in the conversion sandbox | No | No |
| Claude usage numbers | Yes, from Claude's own usage endpoints | Daily history and short-lived caches | No |
| OpenAI usage numbers | Yes, when first-party ChatGPT responses expose supported numeric fields | Latest normalized snapshot | No |
| Raw OpenAI account response | Inspected transiently in the page world | No | No |
| Claude organization UUID | Yes, to address the account's own usage endpoint | Cached locally for a bounded period | No |
| Session or authentication cookies | Never read | Never | Never |
| User settings | n/a | Yes | No |

Local data is stored in `chrome.storage.local` and `chrome.storage.session`. Clearing Companion's local data removes settings, usage history, cached readings, badge ownership, and notification deduplication state.

## 2. Permissions

From `manifest.json`:

| Permission | Purpose |
| --- | --- |
| `storage` | Store settings and numeric usage history locally. |
| `activeTab` | Let the toolbar popup inspect the currently active provider tab after the user opens the popup. |
| `notifications` | Optional 85% and 95% limit alerts. |
| `offscreen` | Host the privileged relay used by the sandboxed file-conversion pipeline. |
| `alarms` | Remove an OpenAI warning badge when its native usage reading becomes more than two hours old, even if no ChatGPT tab remains open. |

The alarm contains only the provider name and observation timestamp. It does not contain account, conversation, prompt, or usage payload data. Companion does not request the broad `tabs` permission.

Host permissions are limited to:

- `https://claude.ai/*`
- `https://*.claude.ai/*`
- `https://chatgpt.com/*`
- `https://*.chatgpt.com/*`
- `https://chat.openai.com/*`

There is no `<all_urls>` permission.

## 3. Network behavior

### Claude

Companion issues read-only same-origin requests to Claude usage endpoints, including organization usage and the optional overage-spend limit. The browser attaches the user's existing Claude session because the request is same-origin. Companion never reads or stores the session cookie.

### OpenAI

The OpenAI page observer does not create account or billing requests. It passively observes first-party ChatGPT responses whose path suggests usage, limits, quota, credits, billing, subscription, rate limits, or agentic usage.

Before anything crosses the page boundary, the observer reduces the response to supported numeric fields:

- utilization percentages
- used and limit values
- reset timestamps
- supported token counters
- a short source pathname

Query strings are removed from source metadata. Raw response bodies, profile fields, conversation content, and URL query values are not forwarded.

### Third parties

Companion has no third-party runtime endpoint. Store updates are handled by the browser or by the user's unpacked-extension workflow.

## 4. Architecture and trust boundaries

```text
Claude page world
  injected.js observes model and generation signals
        │ narrow authenticated events
        ▼
Claude isolated content script
  UI, native usage reads, Caveman Mode

ChatGPT page world
  openai-observer.js observes first-party usage responses
        │ normalized JSON on random per-page event names
        ▼
OpenAI isolated content script
  openai-channel.js validates channel + payload
  openai-content.js renders UI and forwards validated numbers

Provider content scripts
        │ chrome.runtime messages with sender and schema validation
        ▼
Service worker
  provider backgrounds + serialized badge owner
  local storage, bounded expiry alarm, badge, notifications
        │
        ▼
Offscreen relay
        │ bytes in / Markdown out
        ▼
Opaque-origin sandbox
  office and PDF parser, no chrome.* APIs, no network
```

### Claude bridge

The existing Claude adapter uses its own page-world observer and authenticated event contract. Claude and OpenAI message names, storage keys, and background handlers remain separate.

### OpenAI bridge

At `document_start`, the isolated OpenAI script creates a random channel identifier in a temporary DOM mailbox. The MAIN-world observer reads and removes the mailbox immediately, then emits later usage and generation events on event names derived from that random identifier.

The mailbox contains no account data and exists only during startup. Later event payloads are JSON strings containing normalized numeric data. The isolated adapter rejects malformed, oversized, or unexpected payloads before forwarding anything to the background.

The background then validates again:

- extension sender identity
- top-frame origin
- exact trusted HTTPS host
- allowed message keys
- allowed surface and bucket names
- units
- timestamps
- numeric ranges and size limits

This creates defense in depth. A page script would need the ephemeral random channel and would still have to satisfy the isolated-world and background schemas.

### Shared toolbar badge

Claude and OpenAI retain separate usage adapters, but the browser exposes one shared toolbar badge. `badge-state.js` serializes ownership updates from both providers and stores only `{provider, observedAt, alarmName}` in session storage.

A high OpenAI reading schedules one alarm for two hours after its observation time. When the alarm fires, the badge is cleared only if that exact OpenAI snapshot still owns it. A newer Claude reading, a newer OpenAI reading, or a low reading replaces or removes ownership, so an obsolete alarm cannot clear the wrong provider's badge.

## 5. Content Security Policy

Extension pages allow only packaged scripts and exact provider network destinations. Remote scripts and `eval` are not permitted in privileged extension pages.

The file-conversion sandbox intentionally has a separate CSP. It permits the bundled parser and local blob worker, but has an opaque origin, no `chrome.*` access, and no HTTP, HTTPS, or WebSocket egress.

## 6. Credentials and sessions

Companion never reads, stores, logs, or transmits provider passwords, authentication tokens, or session cookies.

Claude usage reads are same-origin and credentialed by the browser. The only Claude identifier cached by Companion is the non-secret organization UUID needed to address the user's own usage endpoint.

The OpenAI adapter does not retain request headers, cookies, query strings, or raw account responses.

## 7. File-conversion sandbox

Caveman Mode's file-to-Markdown feature accepts user-selected formats such as PDF, DOCX, PPTX, XLSX, CSV, HTML, text, and OpenDocument files.

The privileged offscreen page relays bytes but does not run the third-party parser. Parsing occurs inside a manifest-declared sandbox page with:

- opaque origin
- no extension APIs
- no provider-session access
- no network egress
- no persistent file storage

The resulting Markdown is returned to the active composer only after the user selects a file.

## 8. Prompt handling

Caveman Mode is local and user-controlled:

- A fixed visible instruction requests concise replies.
- Prompt compression is deterministic and extractive-only.
- Protected content such as code blocks, quotes, URLs, and email addresses is not paraphrased.
- The user reviews the preview before sending.
- Prompt text is not written to extension storage.

## 9. Threat model

| Threat | Mitigation |
| --- | --- |
| Hostile page script forges usage data | Random per-page channel, temporary mailbox removed at startup, strict isolated and background validation. |
| Raw OpenAI account data leaks into extension storage | Normalization happens in the page world; only bounded numeric snapshots cross the bridge. |
| Sensitive URL query values are retained | Source metadata stores the pathname only. |
| Third-party lookalike endpoint is inspected | Observer accepts exact ChatGPT HTTPS origins only. |
| Old OpenAI alarm clears a newer Claude or OpenAI badge | Serialized badge ownership requires an exact provider and observation-time match before clearing. |
| Stale OpenAI badge remains indefinitely | A single bounded alarm clears the badge after two hours if that snapshot still owns it. |
| Oversized or malformed runtime message | Schema, key, unit, timestamp, numeric, and size validation. |
| File-parser exploit | Parser is confined to an opaque-origin sandbox with no network or extension privileges. |
| Prompt, reply, or file exfiltration | No Companion backend; content is not persisted or transmitted; sandbox has no network. |
| Session-cookie theft | Cookies are never read. |
| Account modification | Provider behavior is read-only; Companion issues no state-changing account request. |
| Over-broad site access | Exact Claude and ChatGPT hosts only; no `<all_urls>` and no broad `tabs` permission. |

## 10. How to audit

1. Review `manifest.json` for permissions, host access, content-script worlds, CSP, and sandbox declarations.
2. Review `src/openai-observer.js`, `src/openai-channel.js`, and `src/openai-background.js` for OpenAI normalization and validation.
3. Review `src/injected.js`, `src/native-usage.js`, and `src/background.js` for Claude behavior.
4. Review `src/badge-state.js` and `src/badge-router.js` for cross-provider badge ownership and expiry.
5. Search for analytics SDKs, telemetry URLs, or remote script loading. None should exist.
6. Search storage writes for prompt, reply, and file contents. None should exist.
7. Run the committed Chromium suite. It checks provider isolation, native OpenAI usage rendering, query-string stripping, page-event forgery resistance, freshness, badge ownership, sandboxed conversion, and accessibility.
8. Inspect the conversion sandbox in DevTools. Its origin is `null`, it has no `chrome` object, and its CSP forbids network egress.

## 11. Known limitations

- Claude and OpenAI expose internal web response shapes that can change. Companion fails closed by omitting unsupported usage rows rather than guessing.
- A browser extension cannot inject into the standalone native Codex desktop shell unless that shell provides an extension-enabled browser surface.
- When loaded unpacked, the extension is only as trustworthy as the local repository folder. Restrict write access to that folder.
- The vendored office and PDF parser should be reviewed and updated periodically even though it runs inside the sandbox.

For installation and everyday use, see [QUICKSTART.md](QUICKSTART.md). For OpenAI-specific semantics, see [OPENAI_SUPPORT.md](OPENAI_SUPPORT.md). For version history, see [../CHANGELOG.md](../CHANGELOG.md).
