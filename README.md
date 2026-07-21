<div align="center">

<h1>Companion</h1>

<h3>A private usage meter and efficiency layer for Claude, ChatGPT, Work, and Codex-aware web surfaces.</h3>

<p>Know what the provider actually reports. Stretch your limits when they run low. Keep every prompt, reply, and file on your device.</p>

<p>
  <img alt="Chrome and Edge, Manifest V3" src="https://img.shields.io/badge/Chrome%20%26%20Edge-Manifest%20V3-3d7a5c?style=for-the-badge&logo=googlechrome&logoColor=white" />
  <img alt="Claude and ChatGPT" src="https://img.shields.io/badge/Claude%20%2B%20ChatGPT-auto--detect-2b3648?style=for-the-badge" />
  <img alt="100 percent local and private" src="https://img.shields.io/badge/100%25-local%20%26%20private-3d7a5c?style=for-the-badge" />
  <img alt="version 1.2.0" src="https://img.shields.io/badge/version-1.2.0-7c5cff?style=for-the-badge" />
</p>

<p>
  <img alt="no telemetry" src="https://img.shields.io/badge/telemetry-none-3d7a5c?style=flat-square" />
  <img alt="no trackers" src="https://img.shields.io/badge/trackers-zero-3d7a5c?style=flat-square" />
  <img alt="sandboxed file parser" src="https://img.shields.io/badge/file%20parser-sandboxed-3d7a5c?style=flat-square" />
  <img alt="read only provider access" src="https://img.shields.io/badge/provider%20access-read--only-b4791f?style=flat-square" />
</p>

<br/>

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/images/widget-dark.png">
  <img alt="Companion docked beneath a chat composer" src="docs/images/widget.png" width="760">
</picture>

<br/>
<sub>Companion docks beneath the active composer, follows the page theme, and changes its visual language for Claude, Chat, Work, and Codex.</sub>

</div>

---

## One extension, four surfaces

Companion auto-detects where it is running. It does not ask you to choose a provider, install a second extension, or keep separate settings.

| Surface | What Companion does |
| --- | --- |
| **Claude.ai** | Shows Claude's exact usage-credit spend, rolling session and weekly limits, Opus usage, reset times, pace warnings, and local history. |
| **ChatGPT Chat** | Adds a native-looking Chat widget, Caveman Mode, prompt trimming, local file conversion, and any numeric usage counters OpenAI exposes to the page. |
| **ChatGPT Work** | Switches to a restrained violet treatment and shows the shared agentic usage pool when OpenAI exposes it. |
| **Codex-aware web surfaces** | Switches to a graphite and indigo interface with selective monospace details and shows shared agentic usage when available. |

> [!IMPORTANT]
> The standalone Codex desktop shell is not a Chrome extension host. Companion cannot inject into that native shell through Manifest V3. It can support Codex-aware web routes and display shared Work or Codex agentic usage that OpenAI exposes on ChatGPT web.

## The rule: native numbers or nothing

Most usage extensions scrape conversation text, estimate tokens, multiply by a price, and present the result as fact. Companion does not.

### On Claude

Claude's own usage-credit counter is the source of truth. Dollar values are exact to the cent. Session and daily spend are deltas from that real counter. Token figures are the only derived values, and they appear as a range rather than fake precision.

### On OpenAI surfaces

Companion passively inspects only first-party ChatGPT responses whose path suggests usage, limits, quota, credits, billing, subscriptions, rate limits, or agentic usage. It extracts supported numeric fields inside the page and forwards only normalized numbers to the extension.

Depending on the account and surface, this can include:

- agentic credits used and available
- rolling session, daily, weekly, or monthly utilization
- reset timestamps
- exact input, output, or total token counters returned by OpenAI

When OpenAI does not expose a trustworthy counter, Companion says it is waiting for native usage data. It does not invent a quota or inspect messages to fill the gap.

---

## Features

| | |
| --- | --- |
| **Automatic provider detection** | Claude, Chat, Work, and Codex styling switch automatically from the current origin, route, and selected mode. |
| **Native usage meters** | Exact Claude spend and limits, plus supported numeric OpenAI counters when exposed. |
| **Caveman Mode** | Ask for maximally concise replies, preview a locally trimmed prompt, and convert files to lean Markdown. |
| **Before-the-wall alerts** | Toolbar badge and optional desktop notice when a trustworthy limit reaches 85 or 95 percent. |
| **Native visual fit** | Shadow DOM widget, exact composer width, page-level light and dark theme following, keyboard focus, and reduced-motion support. |
| **Only what you want** | Hide the widget, Caveman Mode, or individual Claude metrics from Settings. |
| **Private by design** | No telemetry, no analytics, no prompt storage, and no third-party backend. |

## Caveman Mode

Running low and still need to finish something important? Turn on Caveman Mode.

- **Shorter replies:** A one-time visible instruction asks the assistant to answer in the fewest words that preserve every important fact, step, and caveat.
- **Prompt trimming:** Before send, Companion offers a conservative local rewrite that removes filler without paraphrasing protected content. You approve every send.
- **File to Markdown:** Pick a PDF, DOCX, PPTX, XLSX, CSV, HTML, text, or OpenDocument file and convert it locally into lean Markdown before it enters the chat box.

Nothing is silently sent. The preview always lets you send the trimmed version, edit it, send the original, or cancel.

---

## How it works

```text
Claude usage counter ── sampled locally ──► exact spend and native limits

OpenAI first-party response ── normalize numeric fields in-page ──►
  bounded usage snapshot only ──► local widget, popup, badge, and alerts

Your prompt ── optional local Caveman preview ──► your explicit send action
Your file   ── sandboxed local parser ──► Markdown in the active composer
```

The Claude and OpenAI adapters are separate. A tiny service-worker entry point composes them, while each provider keeps its own origin validation, storage keys, network observer, and page integration.

## Security and privacy

Companion is designed to survive a serious extension review.

- **Exact origins only:** Permissions are limited to Claude and ChatGPT HTTPS hosts. There is no `<all_urls>` access.
- **Least privilege:** The extension uses `activeTab`, not the broad `tabs` permission.
- **Read only:** Companion never changes provider account data, conversations, subscriptions, or settings.
- **One-time OpenAI channel:** At `document_start`, the isolated extension script creates a random channel identifier in a temporary DOM mailbox. The MAIN-world observer reads and removes it immediately. Later events use unguessable channel names.
- **Sanitized OpenAI data:** Raw account responses never cross the bridge. Only bounded numeric counters, utilization, reset times, and a source path with its query string removed are emitted.
- **Defense in depth:** The background validates the extension sender, top frame, exact HTTPS origin, allowed keys, value bounds, units, bucket names, and timestamps again before storing anything.
- **No conversation collection:** Prompt and reply text are never stored or transmitted by Companion.
- **Sandboxed document parsing:** The office parser runs in an opaque-origin sandbox with no extension API access and no network access.
- **No telemetry:** There are no analytics SDKs, trackers, remote logs, or Companion servers.

See **[Security and Privacy](docs/SECURITY.md)** and **[OpenAI Support](docs/OPENAI_SUPPORT.md)** for the full architecture.

---

## Quick start

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Choose **Load unpacked** and select this repository folder.
4. Open or reload **Claude.ai** or **ChatGPT.com**.
5. Start a normal chat. Companion appears beneath the composer automatically.

The toolbar popup routes itself to the correct provider. Claude keeps the full spend and history dashboard. ChatGPT gets a dedicated native usage view for Chat, Work, and Codex-aware state.

Full walkthrough: **[Quick Start](docs/QUICKSTART.md)**

## Documentation

| | |
| --- | --- |
| **[Quick Start](docs/QUICKSTART.md)** | Installation, everyday use, and troubleshooting. |
| **[OpenAI Support](docs/OPENAI_SUPPORT.md)** | Chat, Work, Codex behavior, usage semantics, and the desktop boundary. |
| **[Security and Privacy](docs/SECURITY.md)** | Permissions, data handling, threat model, and audit steps. |
| **[Changelog](CHANGELOG.md)** | Version history. |
| **[Contributing](CONTRIBUTING.md)** | Development and review guidance. |

## FAQ

<details>
<summary><strong>Does it work on Claude Free, Pro, Max, Team, and Enterprise?</strong></summary>
<br/>
Yes. Companion reads whatever native usage data the account exposes. Personal-plan users can hide the monthly-credit view for a cleaner Claude widget.
</details>

<details>
<summary><strong>Does it work on ChatGPT Chat and Work?</strong></summary>
<br/>
Yes. The widget, Caveman Mode, prompt preview, and file conversion work on supported ChatGPT web composers. Usage rows appear only when OpenAI exposes supported numeric data for the current account and surface.
</details>

<details>
<summary><strong>Does it work inside the standalone Codex desktop app?</strong></summary>
<br/>
Not as a Chrome content script. Native desktop shells do not automatically host Manifest V3 extensions. Companion is ready for Codex-aware ChatGPT web routes and can show shared agentic usage that appears on the web.
</details>

<details>
<summary><strong>Does Companion send my prompts or chats anywhere?</strong></summary>
<br/>
No. Prompt and reply text are never stored or transmitted by Companion. The extension contacts only the provider pages you opened and has no analytics or telemetry backend.
</details>

<details>
<summary><strong>How accurate are the numbers?</strong></summary>
<br/>
Claude dollar figures are exact because they come from Claude's own counter. OpenAI figures are shown only when OpenAI returns the numeric field directly. Companion labels unavailable data instead of replacing it with an estimate.
</details>

<details>
<summary><strong>Can a website forge a usage event?</strong></summary>
<br/>
Companion creates a random per-page channel during `document_start`, removes its temporary mailbox immediately, and accepts later page-world events only on the unguessable channel names. The privileged background then validates the sender, top frame, exact HTTPS origin, message keys, value bounds, units, bucket names, and timestamps again before storing anything.
</details>

---

<div align="center">

**Built for people who would rather finish the work than discover a limit halfway through it.**

⭐ Star the project if Companion saved a session.

<sub>Not affiliated with or endorsed by Anthropic or OpenAI. Claude, ChatGPT, Work, and Codex are trademarks of their respective owners.</sub>

</div>
