# Privacy Policy — COMPANION

**Last updated: August 4, 2026**

This policy explains how the **COMPANION** browser extension handles data. COMPANION is an independent, unofficial project. It is not affiliated with or endorsed by Anthropic, OpenAI, Microsoft, Hugging Face, or the model author.

A public copy of this policy must be available at the URL entered in the Chrome Web Store developer dashboard.

## 1. What COMPANION does

COMPANION is a local usage and efficiency layer for supported Claude and ChatGPT web surfaces.

- On Claude, it reads native usage and limit information available to the signed-in account and displays it in an in-page widget and toolbar popup.
- On ChatGPT web surfaces, it passively observes first-party page responses and extracts only recognized bounded numeric usage fields.
- Lifejacket Mode can run a bundled quantized prompt compressor locally, append a visible shorter-reply instruction, and convert a user-selected file to Markdown.
- Optional badges and desktop notifications warn when a trustworthy native limit reaches a configured threshold.

COMPANION does not modify provider accounts, subscriptions, or server-side settings.

## 2. Data collected by the developer

**None.**

The developer does not operate a COMPANION server and does not receive extension data. There is **No analytics**, telemetry, advertising SDK, tracking pixel, crash-reporting service, or remote logging endpoint.

The following sections describe data handled locally on the user's device.

## 3. Data stored locally

COMPANION uses `chrome.storage.local` and `chrome.storage.session` for these categories:

| Data | Storage and retention | Purpose |
| --- | --- | --- |
| Display, alert, export, model, and Lifejacket preferences | Local storage until cleared or uninstalled | Remember user choices |
| Claude daily spend history and session baseline | Daily history in local storage; current baseline in session storage | Show session, daily, weekly, and monthly views |
| Claude organization identifier and learned usage endpoint pathname | Small bounded local caches | Address the signed-in account's usage endpoints and tolerate provider route changes |
| Latest normalized **OpenAI usage snapshot** | Session storage when available, with a local-storage fallback | Render the latest supported numeric usage fields |
| OpenAI snapshot freshness and source pathname | Stored with the normalized snapshot; query strings excluded | Label readings fresh, aging, stale, or expired |
| Notification deduplication state | Local storage | Avoid repeating the same threshold warning in one reset window |
| Shared toolbar-badge ownership and expiry metadata | Session storage and one Chrome alarm | Prevent provider updates from overwriting each other and clear stale warnings |

An OpenAI usage snapshot may include bounded utilization numbers, used and limit values, supported token counters, reset timestamps, surface name, observation time, and a short source pathname. It does not include raw account responses, headers, cookies, query strings, profile fields, prompt text, reply text, or file contents.

The pre-1.3 prompt-efficiency setting is read once for migration to Lifejacket. The retired runtime remains disabled.

## 4. Data handled transiently but not stored

### Prompt text and local model input

When the user enables Lifejacket prompt compression and initiates a send from a supported composer, COMPANION reads the current draft transiently and sends it only through internal extension messaging to a local offscreen document.

The bundled MobileBERT LLMLingua-2-style Q8 model runs on the device through CPU/WASM. Prompt text, token scores, and compressed output are not written to extension storage, sent to the developer, or sent to a model-hosting service.

COMPANION displays an editable preview. The user decides whether the optimized prompt, the original prompt, an edited version, or nothing is submitted to the provider.

### Reply-brevity instruction

When enabled, COMPANION appends one visible instruction to the end of the preview asking the provider for a shorter answer. It is not inserted into a hidden system message.

### Provider replies

Claude and ChatGPT reply text is not collected, stored, or transmitted by COMPANION.

### User-selected files

When the user explicitly chooses a supported file, its bytes are handled locally. Markdown and text files are read by the isolated content script. Other supported files are relayed to a manifest-declared opaque-origin parser sandbox.

The sandbox has no extension API access and no HTTP, HTTPS, or WebSocket network access. The file and resulting Markdown are not retained after the conversion flow completes.

### Raw OpenAI responses

Raw first-party ChatGPT account responses are inspected only inside the ChatGPT page world. Normalization occurs before data crosses into the extension. Raw response bodies are not stored or forwarded.

## 5. Network behavior

COMPANION has host access only to:

- `https://claude.ai/*`
- `https://*.claude.ai/*`
- `https://chatgpt.com/*`
- `https://*.chatgpt.com/*`
- `https://chat.openai.com/*`

### Claude

COMPANION makes read-only same-origin requests to Claude usage endpoints using the browser's existing signed-in session. The browser handles authentication. COMPANION does not read, store, log, or transmit the session cookie.

### ChatGPT and OpenAI web surfaces

COMPANION does not create account, billing, or quota requests to OpenAI. A page-world observer passively examines relevant first-party responses and reduces recognized results to bounded numeric fields before anything enters the extension.

### Lifejacket

Lifejacket has no runtime network endpoint. Model weights, tokenizer files, JavaScript, WASM, and license notices ship in the extension package. Remote model loading is disabled.

### Third parties

COMPANION has no third-party runtime endpoint. Browser-store updates are delivered by the browser.

## 6. Permissions

| Permission | Purpose |
| --- | --- |
| `storage` | Store settings, numeric history, normalized snapshots, and small operational state locally |
| `activeTab` | Identify the active supported provider tab after the user opens the toolbar popup |
| `notifications` | Show optional native-limit warnings |
| `offscreen` | Run local Q8/WASM prompt inference and host the privileged file-conversion relay |
| `alarms` | Expire stale usage warnings and reconcile the toolbar badge |
| Exact Claude and ChatGPT host permissions | Run provider-specific adapters only on supported HTTPS origins |

COMPANION does not request `<all_urls>`, the broad `tabs` permission, browsing history, bookmarks, downloads, identity, payment, microphone, camera, or geolocation access.

## 7. Data sharing and human access

COMPANION does not sell, license, transfer, or share user data with the developer, advertisers, data brokers, analytics providers, or other third parties. No developer employee or contractor can read data handled by the extension because none is sent to a developer-controlled system.

The provider receives only content the user explicitly chooses to submit through the provider's composer. Provider-side handling is governed by that provider's terms and privacy policy.

## 8. Retention and deletion

Local data remains in browser storage until it is cleared, expires under the rules above, or the extension is uninstalled.

Users can delete COMPANION data by:

1. opening COMPANION Settings and choosing **Clear all local data**; or
2. uninstalling the extension.

The clear-data action removes settings, Claude history and caches, OpenAI snapshots and operational state, notification state, migration state, session data, and the toolbar badge. Provider accounts and conversations are not changed.

Because the developer receives no extension data, there is no server-side copy to request or delete.

## 9. Security measures

COMPANION uses exact HTTPS host permissions, Manifest V3 content-script isolation, random per-page OpenAI event channels, top-frame and sender validation, schema and range validation, query-string removal, serialized badge ownership, a restrictive extension Content Security Policy, local-only model loading, protected prompt spans, conservative compression fallback, and a no-network parser sandbox.

Technical details are documented in `docs/SECURITY.md` and `docs/LIFEJACKET_MODE.md`.

## 10. Chrome Web Store Limited Use

COMPANION's use of information is limited to providing or improving its disclosed single purpose and user-facing features. It does not use or transfer user data for advertising, creditworthiness, lending, data brokerage, or unrelated purposes. This use follows the Chrome Web Store User Data Policy, including its Limited Use requirements.

## 11. Children's privacy

COMPANION is a general productivity tool and is not directed to children. The developer does not knowingly collect personal information from anyone, including children.

## 12. Changes to this policy

Material changes to data handling will be reflected here, in Chrome Web Store disclosure fields, in user-facing product copy where required, and in `CHANGELOG.md` before publication.

## 13. Contact

Questions about COMPANION privacy or security can be sent to:

**zgbrenner@gmail.com**

Source code and documentation are maintained at `https://github.com/zgbrenner/companion`.
