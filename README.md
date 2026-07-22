<div align="center">

<img src="icons/orbit-c.svg" alt="COMPANION Orbit C icon" width="96" height="96">

<h1>COMPANION</h1>

<h3>Private usage and efficiency tools for Claude and ChatGPT</h3>

<p><strong>Native numbers or nothing.</strong> See provider-reported usage when it is available, finish more work before a limit, and keep prompts, replies, files, and history private.</p>

<p>
  <img alt="Version 1.2.0" src="https://img.shields.io/badge/version-1.2.0-7C6CFF?style=for-the-badge" />
  <img alt="Chrome Manifest V3" src="https://img.shields.io/badge/Chrome-Manifest%20V3-111827?style=for-the-badge&logo=googlechrome&logoColor=white" />
  <img alt="No analytics or telemetry" src="https://img.shields.io/badge/analytics%20%26%20telemetry-none-168363?style=for-the-badge" />
</p>

<p>
  <a href="#install-and-test">Install and test</a> ·
  <a href="docs/SECURITY.md">Security</a> ·
  <a href="store/privacy-policy.md">Privacy policy</a> ·
  <a href="RELEASE_NOTES_1.2.0.md">Release notes</a>
</p>

<img alt="COMPANION widget" src="docs/images/widget.png" width="900">

<sub>The Chrome Web Store URL will be added after v1.2.0 is approved. The repository package is ready for trusted release testing.</sub>

</div>

---

## The problem

Claude and ChatGPT are where a growing amount of real work happens, but usage visibility is fragmented, easy to miss, and different across providers and account types.

Many tools fill missing data with token estimates that look more certain than they are. COMPANION takes the opposite approach:

> **Show a native value when the provider exposes it. Say when it does not. Never turn a guess into a fact.**

COMPANION also places local efficiency tools beside the active composer, so the same privacy-first workflow follows you across supported providers.

## One extension, four web surfaces

COMPANION detects the current provider and surface automatically. There is no manual provider switch and no second extension to install.

| Surface | What COMPANION does |
| --- | --- |
| **Claude.ai** | Shows native usage-credit spend, rolling session and weekly limits, Opus usage, reset times, local history, pace warnings, and plan-fit insights when those values are exposed. |
| **ChatGPT Chat** | Adds a native-looking widget, local Caveman tools, and supported numeric usage fields that OpenAI exposes to the page. |
| **ChatGPT Work** | Uses restrained Work context styling and shows supported shared agentic usage when available. |
| **Codex-aware ChatGPT web routes** | Uses graphite and indigo context styling and shows supported shared agentic usage when available. |

> [!IMPORTANT]
> The standalone native Codex desktop application is not a Chrome extension host. COMPANION supports Codex-aware web surfaces and native numeric data exposed through ChatGPT web. It does not claim to inject into the desktop shell.

## What it looks like

### Claude usage and history

<img alt="COMPANION Claude usage popup" src="docs/images/popup.png" width="900">

### ChatGPT, Work, and Codex-aware web support

The release workflow renders the current ChatGPT popup and composes the Chrome Web Store and Product Hunt images from that tested surface. Those platform-sized images ship in the `companion-v1.2.0-launch-assets` workflow artifact so they cannot drift from the release commit.

### Privacy-first settings

<img alt="COMPANION privacy and settings" src="docs/images/settings.png" width="900">

## Features

| Feature | What it means |
| --- | --- |
| **Automatic provider detection** | Claude, Chat, Work, and Codex-aware styling switch from the current origin, route, and selected mode. |
| **Native usage views** | Exact Claude spend and native limits, plus supported numeric OpenAI fields when OpenAI exposes them. |
| **Freshness and expiry** | OpenAI readings are labeled fresh, aging, stale, or expired instead of remaining on screen indefinitely. |
| **Caveman Mode** | Ask for concise replies, preview a conservative local prompt trim, and convert files to lean Markdown. |
| **Before-the-wall alerts** | Optional toolbar badge and desktop warnings at 85% and 95% of a trustworthy native limit. |
| **Local history** | Claude daily and weekly views, trend chart, export, pace, and plan-fit insight stay in browser storage. |
| **Per-metric controls** | Hide individual Claude metrics, the widget, Caveman Mode, notifications, or the toolbar badge. |
| **Provider-native visual fit** | Shadow DOM widgets follow the host surface, composer width, light or dark appearance, keyboard focus, and reduced-motion preference. |
| **Complete local reset** | One Settings action clears Claude and OpenAI local state, caches, session data, alarms, and the toolbar badge. |

## Caveman Mode

Caveman Mode is optional, visible, and user-controlled.

### Concise replies

A fixed instruction asks the provider to use the fewest words that preserve the important facts, steps, and caveats.

### Conservative local prompt preview

When enabled, COMPANION can offer a local extractive trim before send. You choose whether to:

- use the trimmed prompt
- edit the trimmed prompt
- send the original
- cancel

Nothing is silently sent. Prompt text is not written to extension storage or sent to the developer.

### Local file to Markdown

Select a PDF, DOCX, PPTX, XLSX, CSV, HTML, text, or OpenDocument file and convert it locally into lean Markdown before deciding what enters the provider composer.

Parsing runs in a manifest-declared opaque-origin sandbox with:

- no network access
- no extension API access
- no provider session access
- no persistent file storage

<img alt="COMPANION dark widget" src="docs/images/widget-dark.png" width="900">

## Privacy is an architecture decision

COMPANION has:

- no COMPANION account
- no developer backend
- no analytics or telemetry
- no advertising or trackers
- no remote code
- no remote fonts
- no broad `<all_urls>` permission
- no broad `tabs` permission
- no prompt or reply storage
- no raw OpenAI response storage
- no file upload to a COMPANION service

### Claude boundary

Claude usage reads are read-only and same-origin. The browser authenticates them using the existing signed-in session. COMPANION never reads or stores the session cookie.

### OpenAI boundary

Raw first-party ChatGPT responses stay in the page world. A random per-page channel carries only normalized JSON containing supported bounded numeric fields. The isolated script validates it, and the service worker validates sender, top frame, origin, keys, units, bucket names, timestamps, ranges, and payload size again.

### Shared badge boundary

Claude and OpenAI keep separate usage adapters but share one browser toolbar badge. A serialized owner prevents a stale provider update or alarm from clearing a newer provider warning.

Read the full **[Security and Privacy architecture](docs/SECURITY.md)** and **[Chrome Web Store privacy policy](store/privacy-policy.md)**.

## How the data flows

```text
Claude native usage endpoints
        │ read-only, same-origin
        ▼
Claude adapter ─────────────► local widget, popup, history, alerts

ChatGPT first-party response
        │ normalize supported numeric fields inside the page
        ▼
random per-page channel
        │ validate again
        ▼
OpenAI adapter ─────────────► local widget, popup, freshness, alerts

user-selected file
        │ explicit action
        ▼
opaque-origin no-network sandbox ──► Markdown preview/composer
```

The Claude and OpenAI adapters use separate message names, storage keys, network observers, and validation logic. A small service-worker entry point composes them without merging provider trust boundaries.

## Install and test

### Chrome Web Store

The public Chrome Web Store link will be inserted here after v1.2.0 approval and final smoke testing.

### Trusted release candidate

Use the artifact produced by the **release-package** GitHub Actions workflow. It contains the tested Web Store ZIP, checksum, release notes, package inventory, test transcript, and separate launch-artwork bundle.

1. Download and extract `companion-1.2.0.zip`.
2. Open `chrome://extensions`.
3. Enable **Developer mode**.
4. Choose **Load unpacked**.
5. Select the extracted directory containing `manifest.json`.
6. Open or reload Claude.ai or ChatGPT.com.

### Build from source

```bash
git clone https://github.com/zgbrenner/claudecompanion.git
cd claudecompanion
tools/package-webstore.sh
```

The deterministic package is written to:

```text
dist/companion-1.2.0.zip
```

A SHA-256 checksum is written beside it.

## Accuracy boundaries

### Claude

Claude dollar values come from Claude's own native usage-credit counter. Session and history values are deltas from that counter. Token figures are derived ranges, not exact counts.

### OpenAI

OpenAI exposes different account data by plan and surface. COMPANION renders only recognized native numeric fields. A waiting or empty state can be the correct result.

### Provider changes

Claude and ChatGPT are web applications and their internal layouts or response shapes can change. COMPANION fails closed by omitting unsupported rows instead of presenting stale or guessed data as current.

## Verification

The committed Chromium suite covers:

- extension boot and settings persistence
- Claude and OpenAI popup rendering
- sandboxed document conversion
- accessibility audits
- provider and surface detection
- least-privilege manifest rules
- OpenAI normalization, query stripping, and forgery resistance
- usage freshness and expiry
- provider-aware popup routing
- complete local-data clearing
- badge ownership, restart reconciliation, and single-writer enforcement
- Orbit C brand rendering and local font integrity
- release-readiness documents, package automation, and launch-asset generation

Run locally:

```bash
node tests/run.mjs
```

See `.github/workflows/tests.yml` and `.github/workflows/release-package.yml` for the pinned CI environment.

## Documentation

| Document | Purpose |
| --- | --- |
| **[Quick Start](docs/QUICKSTART.md)** | Installation, everyday use, and troubleshooting |
| **[OpenAI Support](docs/OPENAI_SUPPORT.md)** | Chat, Work, Codex-aware behavior, usage semantics, and limitations |
| **[Security and Privacy](docs/SECURITY.md)** | Permissions, data flow, threat model, and audit steps |
| **[Privacy Policy](store/privacy-policy.md)** | Public Chrome Web Store privacy policy |
| **[Release Notes](RELEASE_NOTES_1.2.0.md)** | v1.2.0 highlights and upgrade notes |
| **[Changelog](CHANGELOG.md)** | Version history |
| **[Contributing](CONTRIBUTING.md)** | Development and review guidance |

## Support and contribution

After the repository becomes public:

- use GitHub Issues for reproducible bugs
- use GitHub Discussions for questions and workflows, if enabled
- send security-sensitive reports to `zgbrenner@gmail.com`

When reporting a provider issue, include the provider, surface, browser version, extension version, light or dark theme, and URL pathname without query strings. Remove conversation and account content from screenshots. Never share cookies, tokens, or credentials.

Contributions that improve provider resilience, privacy, accessibility, documentation, and testing are welcome.

## FAQ

<details>
<summary><strong>Does COMPANION work on every Claude and ChatGPT plan?</strong></summary>
<br>
The interface and local tools work on supported composers. Usage rows depend on what the signed-in account and current surface expose.
</details>

<details>
<summary><strong>Why is ChatGPT usage blank?</strong></summary>
<br>
OpenAI may expose no supported native counter to that account or surface. COMPANION leaves the state blank rather than estimating a quota.
</details>

<details>
<summary><strong>Does COMPANION send chats or files to the developer?</strong></summary>
<br>
No. There is no developer backend. Prompt text is handled only for an enabled, user-initiated local preview and is not stored. Reply text is not collected. User-selected files are parsed locally in a no-network sandbox.
</details>

<details>
<summary><strong>Can a provider page forge usage data?</strong></summary>
<br>
The OpenAI adapter uses a random per-page event channel and strict validation in both the isolated script and service worker. The Claude and OpenAI adapters also remain separate. The full threat model is documented in `docs/SECURITY.md`.
</details>

<details>
<summary><strong>Does it work inside the native Codex desktop app?</strong></summary>
<br>
No. The native desktop shell is not a Chrome extension host. COMPANION supports Codex-aware ChatGPT web surfaces and shared agentic usage exposed on the web.
</details>

<details>
<summary><strong>Is COMPANION affiliated with Anthropic or OpenAI?</strong></summary>
<br>
No. COMPANION is independent and unofficial. Claude, ChatGPT, Work, and Codex are trademarks of their respective owners.
</details>

---

<div align="center">

**Built for people who would rather finish the work than discover a limit halfway through it.**

After COMPANION has helped, an honest Chrome Web Store review or GitHub star makes the project easier for other people to evaluate.

</div>
