# Chrome Web Store Privacy Practices — COMPANION

Paste-ready answers for the Chrome Web Store developer dashboard. Re-check the dashboard wording before submission because Google can change field labels and data categories.

## Single purpose description

```
COMPANION gives signed-in Claude and ChatGPT web users one local efficiency layer for viewing provider-reported numeric usage and limits when available, receiving optional threshold warnings, preparing concise prompts and replies, and converting user-selected files to Markdown locally. All features serve the single purpose of helping users understand and stretch their AI usage while keeping handled content on-device.
```

## Permission justifications

### storage

```
Used to store the user's settings, Claude numeric spend history, the latest normalized OpenAI usage snapshot, freshness timestamps, bounded provider caches, notification-deduplication state, Caveman conversation state, and shared toolbar-badge ownership. This storage remains on the user's device and can be erased from COMPANION Settings. chrome.storage.sync is not used and no stored value is sent to the developer.
```

### activeTab

```
Used only after the user opens the toolbar popup, so COMPANION can identify whether the active tab is a supported Claude or ChatGPT web surface and route the popup to the correct provider view. COMPANION does not request the broader tabs permission and does not read the user's browser history.
```

### notifications

```
Used for optional, user-configurable desktop warnings when a trustworthy native Claude or OpenAI limit reaches 85% or 95%. Notifications contain only the relevant usage label, utilization percentage, and reset countdown when available. They do not contain prompts, replies, files, account identifiers, or raw provider responses. Users can disable notifications in Settings.
```

### offscreen

```
Used only for the user-initiated file-to-Markdown feature. The offscreen document acts as a privileged relay between the content script and a manifest-declared sandbox. Untrusted file parsing occurs in the opaque-origin sandbox, which has no extension API access and no HTTP, HTTPS, or WebSocket network access. File bytes and converted Markdown are not stored after the conversion flow completes.
```

### alarms

```
Used to expire a high OpenAI toolbar warning two hours after its native usage observation, even if the user has closed every ChatGPT tab. The alarm name contains only the provider and observation timestamp. It does not contain account data, prompt text, reply text, file content, or a usage payload. Serialized ownership checks prevent an old alarm from clearing a newer Claude or OpenAI badge.
```

### Host access: Claude

Applies to:

- `https://claude.ai/*`
- `https://*.claude.ai/*`

```
Required to run COMPANION's Claude widget and read the signed-in user's own native usage and limit information from Claude's first-party HTTPS endpoints. Requests are read-only and same-origin. COMPANION does not read the user's session cookie and cannot modify the account, subscription, settings, or conversations.
```

### Host access: ChatGPT and OpenAI web surfaces

Applies to:

- `https://chatgpt.com/*`
- `https://*.chatgpt.com/*`
- `https://chat.openai.com/*`

```
Required to run COMPANION's ChatGPT widget, local Caveman tools, popup routing, and page-world observer on supported Chat, Work, and Codex-aware web routes. The observer passively inspects only first-party responses whose pathname suggests usage or limit data. Raw responses remain in the page world; only bounded normalized numeric fields and a query-free pathname cross into the extension. COMPANION does not create account or billing requests and cannot modify the user's OpenAI account or conversations.
```

## Remote code

Select:

**No, I am not using remote code.**

Use this explanation if the dashboard provides a text field:

```
All executable code ships inside the uploaded extension package. COMPANION does not download JavaScript, WebAssembly, fonts, or executable configuration at runtime. The bundled office-document parser and PDF worker are version-pinned package assets and run only inside the local file-conversion flow. No code is loaded from a CDN or developer server, and privileged extension pages prohibit remote scripts and eval through their Content Security Policy.
```

## Data usage disclosure checklist

Chrome requires disclosure even when data is handled only on the user's device. The privacy policy must match the selected categories.

### Categories to select

| Category | Select? | Why |
| --- | :---: | --- |
| Website content | **Yes** | COMPANION handles provider usage responses, numeric limit data, composer content for an optional local preview, and provider page state needed to render its user-facing features. |
| Personal communications | **Yes** | When the user enables Caveman Mode and initiates a send, COMPANION transiently handles the draft prompt to offer a local trim preview. Prompt text is not stored or transmitted by COMPANION. |
| User activity | **Yes, if this category appears in the current dashboard** | COMPANION reacts to user-initiated composer sends, file selection, and provider generation state solely to provide visible product features. This state is not used for analytics or behavioral profiling. |

If Google's current dashboard groups prompt and file content under a differently named category such as user-generated content, select that category as well and use the same local-only explanation. Accuracy is more important than minimizing the number of checked boxes.

### Categories normally left unselected

| Category | Select? | Reason |
| --- | :---: | --- |
| Personally identifiable information | No | COMPANION does not collect names, emails, addresses, usernames, or government identifiers. |
| Health information | No | Not handled. |
| Financial and payment information | No | COMPANION does not access payment methods, invoices, banking data, billing addresses, or transactions. A provider's numeric usage-credit counter is handled as website content for the usage-meter feature. |
| Authentication information | No | Passwords, access tokens, and session cookies are never read or stored. |
| Location | No | Not requested or handled. |
| Web history | No | COMPANION runs only on declared provider origins and uses activeTab after a popup click; it does not access browser history. |

## Limited Use certifications

All required certifications can be selected truthfully:

- COMPANION does not sell or transfer user data to third parties outside approved use cases.
- COMPANION does not use or transfer user data for purposes unrelated to its single purpose.
- COMPANION does not use or transfer user data to determine creditworthiness or for lending.

Recommended free-text explanation:

```
COMPANION handles only the data necessary for its visible usage, alert, prompt-preview, and file-conversion features. Processing occurs locally in the browser. No COMPANION server receives user data, no developer or third party can read it, and it is never used for advertising, profiling, data brokerage, creditworthiness, lending, or any unrelated purpose. The use of information adheres to the Chrome Web Store User Data Policy, including the Limited Use requirements.
```

## Public privacy policy URL

The privacy policy URL must be public before submission. Because the repository is currently private, do not submit a private GitHub URL. First either:

1. Make the repository public and use the rendered `store/privacy-policy.md` URL, or
2. Publish the same policy on a public HTTPS page controlled by the developer.

The public text must match this document and `store/privacy-policy.md` exactly in all material respects.
