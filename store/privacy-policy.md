# Privacy Policy — COMPANION

**Last updated: July 21, 2026**

This policy explains how the **COMPANION** browser extension handles data. COMPANION is an independent, unofficial project. It is not affiliated with, endorsed by, sponsored by, or produced by Anthropic or OpenAI.

A public copy of this policy must be available at the URL entered in the Chrome Web Store developer dashboard. Before submission, either make this repository public or publish this document on another public HTTPS page controlled by the developer.

## 1. What COMPANION does

COMPANION is a local usage and efficiency layer for supported Claude and ChatGPT web surfaces.

- On Claude, it reads native usage and limit information made available to the signed-in account and displays that information in an in-page widget and toolbar popup.
- On ChatGPT web surfaces, it passively observes first-party page responses and extracts only supported numeric usage, quota, credit, limit, reset, or token fields.
- Caveman Mode can locally prepare a concise-response instruction, offer a conservative prompt-trimming preview, and convert a user-selected file to Markdown.
- Optional badges and desktop notifications warn when a trustworthy native limit reaches a configured threshold.

COMPANION does not modify provider accounts, subscriptions, conversations, or settings.

## 2. Data collected by the developer

**None.**

The developer does not operate a COMPANION server and does not receive data from the extension. There is **No analytics**, no telemetry, no advertising SDK, no tracking pixel, no crash-reporting service, and no remote logging endpoint.

Because COMPANION handles some data locally on the user's device, the remaining sections describe that local handling in detail.

## 3. Data handled and stored locally

COMPANION uses `chrome.storage.local` and `chrome.storage.session`. The exact stored fields may evolve as the product changes, but the categories and purposes are:

| Data | Storage and retention | Purpose |
| --- | --- | --- |
| Display, alert, export, model, and Caveman preferences | Local storage until cleared or the extension is uninstalled | Remember user choices |
| Claude daily spend history and session baseline | Daily history in local storage; current session baseline in session storage | Show session, daily, weekly, and monthly views |
| Claude organization UUID and learned usage endpoint pathname | Small bounded local caches | Address the signed-in account's own usage endpoints and tolerate provider route changes |
| Latest normalized OpenAI usage snapshot | Session storage when available, with a local-storage fallback | Render the most recently observed supported numeric usage fields |
| OpenAI usage snapshot freshness timestamp and source pathname | Stored with the normalized snapshot; source metadata excludes query strings | Label readings as fresh, aging, stale, or expired |
| Notification deduplication state | Local storage | Avoid repeating the same 85% or 95% warning during one reset window |
| Caveman conversation-instruction state | Local storage, bounded to recent conversation keys | Avoid sending the same concise-response instruction repeatedly in one conversation |
| Shared toolbar-badge ownership and expiry metadata | Session storage and one Chrome alarm | Prevent Claude and OpenAI badge updates from overwriting each other and clear stale OpenAI warnings |

An **OpenAI usage snapshot** contains bounded normalized numbers, such as utilization, used and limit values, supported token counters, reset timestamps, surface name, observation time, and a short source pathname. It does not contain raw account responses, headers, cookies, query strings, profile fields, prompt text, reply text, or file contents.

## 4. Data handled transiently but not stored

### Prompt text

When the user enables Caveman Mode and initiates a send from a supported composer, COMPANION reads the current prompt transiently in the page to offer a local trim preview. The prompt is not written to extension storage, sent to the developer, or sent to any third party by COMPANION. The user controls whether the trimmed version, edited version, original version, or nothing is sent to the provider.

### Provider replies

Claude and ChatGPT reply text is not collected, stored, or transmitted by COMPANION.

### User-selected files

When the user explicitly chooses a file for conversion, its bytes are relayed to a manifest-declared opaque-origin sandbox. The sandbox has no extension API access and no HTTP, HTTPS, or WebSocket network access. The file and resulting Markdown are not retained by COMPANION after the conversion flow completes.

### Raw OpenAI responses

Raw first-party ChatGPT account responses are inspected only inside the ChatGPT page world. Normalization occurs before data crosses into the extension. Raw response bodies are not stored or forwarded.

## 5. Network behavior

COMPANION has host access only to these provider origins:

- `https://claude.ai/*`
- `https://*.claude.ai/*`
- `https://chatgpt.com/*`
- `https://*.chatgpt.com/*`
- `https://chat.openai.com/*`

### Claude

COMPANION makes read-only, same-origin requests to Claude usage endpoints using the browser's existing signed-in session. The browser handles authentication. COMPANION does not read, store, log, or transmit the session cookie. Requests are used only to retrieve the user's own native usage and limit information.

### ChatGPT and OpenAI web surfaces

COMPANION does not create account, billing, or quota requests to OpenAI. A page-world observer passively examines first-party responses whose pathname suggests usage, limits, quota, credits, billing, subscriptions, rate limits, or agentic usage. It reduces supported responses to bounded numeric fields before anything enters the extension.

### Third parties

COMPANION has no third-party runtime endpoint. All executable code, icons, fonts, and parser libraries ship inside the extension package. Browser-store updates are delivered by the browser.

## 6. Permissions

| Permission | Purpose |
| --- | --- |
| `storage` | Store settings, numeric history, normalized snapshots, and small operational state locally |
| `activeTab` | Identify the active supported provider tab after the user opens the toolbar popup |
| `notifications` | Show optional threshold warnings |
| `offscreen` | Host the privileged relay for user-initiated local file conversion |
| `alarms` | Expire a stale OpenAI toolbar warning even when no ChatGPT tab remains open |
| Exact Claude and ChatGPT host permissions | Run the provider-specific widget and usage adapters only on supported HTTPS origins |

COMPANION does not request `<all_urls>`, the broad `tabs` permission, browsing history, bookmarks, downloads, identity, payment, clipboard, microphone, camera, or geolocation access.

## 7. Data sharing and human access

COMPANION does not sell, license, transfer, or share user data with the developer, advertisers, data brokers, analytics providers, or other third parties. No developer employee or contractor can read data handled by the extension because the extension sends none of it to a developer-controlled system.

The provider receives only content the user explicitly chooses to send through the provider's own composer. That provider-side handling is governed by the provider's terms and privacy policy, not this policy.

## 8. Retention and deletion

Local data remains in browser storage until it is cleared, expires under the rules described above, or the extension is uninstalled.

Users can delete COMPANION data by:

1. Opening COMPANION Settings and choosing **Clear all local data**, or
2. Uninstalling the extension.

The clear-data action removes settings, Claude history and caches, OpenAI snapshots and operational state, notification state, Caveman state, session data, and the toolbar badge. Provider accounts and conversations are not changed.

Because the developer receives no extension data, there is no server-side copy to request or delete.

## 9. Security measures

COMPANION uses exact HTTPS host permissions, Manifest V3 content-script isolation, a random per-page OpenAI event channel, schema and range validation in both the page adapter and background, query-string removal, serialized toolbar-badge ownership, a restrictive extension Content Security Policy, and a no-network conversion sandbox.

Technical details are documented in `docs/SECURITY.md`.

## 10. Chrome Web Store Limited Use

COMPANION's use of information is limited to providing or improving its disclosed single purpose and user-facing features. COMPANION does not use or transfer user data for advertising, creditworthiness, lending, data brokerage, or unrelated purposes. This use adheres to the Chrome Web Store User Data Policy, including its Limited Use requirements.

## 11. Children's privacy

COMPANION is a general productivity tool and is not directed to children. The developer does not knowingly collect personal information from anyone, including children.

## 12. Changes to this policy

Material changes to data handling will be reflected here, in the Chrome Web Store disclosure fields, in user-facing product copy where required, and in `CHANGELOG.md` before the changed version is published.

## 13. Contact

Questions about COMPANION's privacy or security can be sent to:

**zgbrenner@gmail.com**

Source code and documentation are maintained at `https://github.com/zgbrenner/claudecompanion` and will be publicly accessible before the public launch.
