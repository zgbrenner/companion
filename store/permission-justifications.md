# Chrome Web Store Privacy Practices — COMPANION

Paste-ready answers for the Chrome Web Store developer dashboard. Re-check the dashboard wording before submission because Google can change field labels and data categories.

## Single purpose description

```text
COMPANION gives signed-in Claude and ChatGPT web users one local efficiency layer for viewing provider-reported numeric usage and limits when available, receiving optional threshold warnings, compressing prompts with a bundled on-device model, requesting shorter replies, and converting user-selected files to Markdown locally. All features serve the single purpose of helping users understand and stretch their AI usage while keeping handled content on-device.
```

## Permission justifications

### `storage`

```text
Used to store user settings, Claude numeric spend history, the latest normalized OpenAI usage snapshot, freshness timestamps, bounded provider caches, notification-deduplication state, one-time settings-migration state, and shared toolbar-badge ownership. Prompt text, reply text, file bytes, converted Markdown, and local-model input/output are never stored. Storage remains on the user's device and can be erased from COMPANION Settings. chrome.storage.sync is not used and no stored value is sent to the developer.
```

### `activeTab`

```text
Used only after the user opens the toolbar popup, so COMPANION can identify whether the active tab is a supported Claude or ChatGPT web surface and route the popup to the correct provider view. COMPANION does not request the broader tabs permission and does not read browser history.
```

### `notifications`

```text
Used for optional user-configurable desktop warnings when a trustworthy native Claude or OpenAI limit reaches 85% or 95%. Notifications contain only the usage label, utilization percentage, and reset countdown when available. They do not contain prompts, replies, files, account identifiers, or raw provider responses. Users can disable notifications in Settings.
```

### `offscreen`

```text
Used for two local features. First, the offscreen document runs the bundled MobileBERT LLMLingua-2-style Q8 model through CPU/WebAssembly when the user enables Lifejacket prompt compression. Second, it relays user-selected file bytes into a manifest-declared opaque-origin parser sandbox. Model input/output is not stored or sent to a remote endpoint. Untrusted file parsing occurs in the sandbox, which has no extension API or network access. File bytes and converted Markdown are not retained after conversion.
```

### `alarms`

```text
Used to expire stale toolbar warnings even when no provider tab remains open. Alarm names contain only provider and observation metadata. They do not contain account data, prompt text, reply text, file content, model output, or a raw usage payload. Serialized ownership checks prevent an old alarm from clearing a newer Claude or OpenAI badge.
```

### Host access: Claude

Applies to:

- `https://claude.ai/*`
- `https://*.claude.ai/*`

```text
Required to run the Claude usage widget, Lifejacket composer panel, and read the signed-in user's own native usage and limit information from Claude first-party HTTPS endpoints. Usage requests are read-only and same-origin. COMPANION does not read the session cookie and cannot modify the account, subscription, settings, or conversations. Lifejacket handles the current draft transiently only after the user turns it on and initiates a send.
```

### Host access: ChatGPT and OpenAI web surfaces

Applies to:

- `https://chatgpt.com/*`
- `https://*.chatgpt.com/*`
- `https://chat.openai.com/*`

```text
Required to run the ChatGPT widget, Lifejacket composer panel, popup routing, and page-world usage observer on supported Chat, Work, and Codex-aware web routes. The observer passively inspects relevant first-party responses. Raw responses remain in the page world; only bounded normalized numeric fields and a query-free pathname cross into the extension. COMPANION does not create account or billing requests and cannot modify the user's OpenAI account or conversations. Lifejacket handles the current draft transiently only after the user turns it on and initiates a send.
```

## Remote code

Select:

**No, I am not using remote code.**

Use this explanation if the dashboard provides a text field:

```text
All executable code, WebAssembly, tokenizer files, and Q8 model weights ship inside the uploaded extension package. COMPANION does not download JavaScript, WebAssembly, model files, fonts, or executable configuration at runtime. The build retrieves pinned source artifacts, verifies cryptographic hashes, extracts only audited browser runtime files, and packages them before Chrome Web Store submission. No code is loaded from a CDN or developer server. Extension pages allow scripts from the extension itself only; wasm-unsafe-eval is used solely to compile the bundled ONNX Runtime WebAssembly binary.
```

## Data usage disclosure checklist

Chrome requires disclosure even when data is handled only on the user's device. The privacy policy and selected dashboard categories must match.

### Categories to select

| Category | Select? | Why |
| --- | :---: | --- |
| Website content | **Yes** | COMPANION handles provider usage responses, numeric limit data, provider page state, and selected document content needed for visible features. |
| Personal communications | **Yes** | When Lifejacket is enabled and the user initiates a send, COMPANION transiently handles the draft prompt to run local compression and show a preview. It is not stored or transmitted by COMPANION. |
| User activity | **Yes, if this category appears** | COMPANION reacts to explicit composer sends, file selection, popup opening, and provider generation state solely to provide visible features. It is not used for analytics or profiling. |
| User-provided content | **Yes, if the dashboard uses this category** | Selected files and composer drafts are processed transiently on-device. |

If Google's current dashboard groups prompt or file content under a different name, select the closest accurate category. Accuracy is more important than minimizing checked boxes.

### Categories normally left unselected

| Category | Select? | Reason |
| --- | :---: | --- |
| Personally identifiable information | Usually no as a distinct collection purpose | COMPANION does not seek or extract names, emails, addresses, usernames, or government identifiers. A user could type such information into a draft, in which case it is covered by the disclosed personal-communications or user-content category and remains transient. Follow the dashboard's current definitions. |
| Health information | No as a product purpose | COMPANION does not seek or classify health data. User-entered draft content remains transient under the content disclosure. |
| Financial and payment information | No | COMPANION does not access payment methods, invoices, banking data, billing addresses, or transactions. Provider numeric usage counters are website content for the usage-meter feature. |
| Authentication information | No | Passwords, access tokens, and session cookies are never read or stored. |
| Location | No | Not requested or handled. |
| Web history | No | COMPANION runs only on declared provider origins and uses activeTab after a popup click; it does not access browser history. |

## Limited Use certifications

All required certifications can be selected truthfully:

- COMPANION does not sell or transfer user data to third parties outside approved use cases.
- COMPANION does not use or transfer user data for purposes unrelated to its single purpose.
- COMPANION does not use or transfer user data to determine creditworthiness or for lending.

Recommended free-text explanation:

```text
COMPANION handles only the data necessary for visible usage, alert, Lifejacket preview, and file-conversion features. Processing occurs locally in the browser. No COMPANION server receives user data, no developer or third party can read it, and it is never used for advertising, profiling, data brokerage, creditworthiness, lending, or an unrelated purpose. This follows the Chrome Web Store User Data Policy, including Limited Use requirements.
```

## Public privacy policy URL

The privacy policy URL must be public before submission. Use the developer-controlled policy page published from this repository:

```text
https://companion.pages.dev/privacy/
```

The page carries the same policy text as `store/privacy-policy.md`; keep the two in sync whenever either changes. The public policy, dashboard disclosures, extension behavior, and this document must agree.
