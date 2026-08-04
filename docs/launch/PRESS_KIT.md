# COMPANION Press Kit

## Product name

**COMPANION**

Always set the product name in all caps.

## Primary tagline

**Private usage and efficiency tools for Claude and ChatGPT**

## One-line description

COMPANION is a privacy-first Chrome extension that shows provider-reported Claude and ChatGPT usage when available and adds local tools for working more efficiently before a limit interrupts the task.

## 40-word description

COMPANION automatically adapts to Claude, ChatGPT Chat, and ChatGPT Work, with narrow legacy Codex route compatibility when such a route appears. It displays native numeric usage when providers expose it, warns before trustworthy limits run hot, and provides local Lifejacket prompt-compression and file-to-Markdown tools without analytics or telemetry.

## 100-word description

COMPANION is one private efficiency layer for Claude and ChatGPT. On Claude, it displays the native usage and limit information available to the signed-in account, including usage-credit spend, rolling limits, reset times, and local history. On ChatGPT web surfaces, it renders only supported numeric usage, quota, credit, limit, reset, or token fields that OpenAI exposes in first-party page responses. It does not estimate missing quotas. COMPANION also includes a user-controlled concise-response mode, conservative local prompt trimming, sandboxed file-to-Markdown conversion, and optional threshold alerts. There is no account, developer backend, analytics, telemetry, or remote code.

## Long description

COMPANION is a privacy-first Chrome extension for people who do substantial work in Claude and ChatGPT and do not want an unexpected usage limit to interrupt the task.

The extension follows one rule: **native numbers or nothing**.

On Claude, COMPANION displays the usage and limit information Claude makes available to the signed-in account, including exact usage-credit spend, rolling session and weekly limits, Opus usage, reset times, and local spend history. On ChatGPT web surfaces, COMPANION passively observes first-party page responses and renders only supported numeric usage, quota, credit, limit, reset, or token fields. When OpenAI does not expose a trustworthy value for the current account or surface, COMPANION shows an honest waiting state instead of inferring a quota from message text.

The extension also provides optional local efficiency tools through Lifejacket Mode. It can append a visible concise-reply instruction, propose a conservative Q8 prompt-compression preview that the user can approve, edit, reject, or cancel, and convert user-selected PDF, Office, text, HTML, CSV, and OpenDocument files to Markdown inside a no-network sandbox.

Privacy is an architectural constraint, not an analytics setting. COMPANION has no developer server, account system, advertising, analytics, telemetry, or tracking. Raw OpenAI account responses remain inside the ChatGPT page. Prompt and reply text is not stored or transmitted by COMPANION. Host access is limited to exact Claude and ChatGPT HTTPS origins.

COMPANION supports Claude, ChatGPT Chat, and ChatGPT Work on the web. Narrow legacy Codex route compatibility is conditional on the route appearing. The standalone native Codex desktop application does not host Chrome extensions, so it is outside the extension's injection boundary.

## Key facts

- Product: Chrome Manifest V3 extension
- Release: v1.4.0
- Price at launch: free
- Source model: open source when the repository is made public
- Supported browser family: Chromium-based browsers that support the required Manifest V3 APIs
- Supported web surfaces: Claude.ai, ChatGPT Chat, and ChatGPT Work
- Native Codex desktop support: no, because the native shell is not a Chrome extension host
- Account requirement: no COMPANION account
- Developer backend: none
- Analytics and telemetry: none
- Remote code: none
- Prompt storage: none
- Reply storage: none
- File retention: none by COMPANION
- File parsing: local opaque-origin sandbox with no network access
- Provider affiliation: none

## Feature summary

### Native usage visibility

- Exact Claude usage-credit spend when exposed
- Claude rolling limits, reset times, Opus usage, and local history
- Supported native OpenAI numeric usage fields when exposed
- Freshness labels and fail-closed empty states
- Provider-aware popup and widget

### Efficiency tools

- Concise-response instruction
- Conservative local Lifejacket prompt-compression preview
- Local file-to-Markdown conversion
- Optional threshold notifications and toolbar badge
- Per-metric and per-feature settings

### Privacy and security

- Exact provider HTTPS hosts only
- No broad all-sites or browsing-history permission
- Random per-page OpenAI event channel
- Raw OpenAI responses normalized inside the page
- Query strings removed from retained source metadata
- Background schema, origin, timestamp, unit, and value validation
- Serialized cross-provider badge ownership
- Complete local-data clearing

## What makes COMPANION different

1. **It refuses to invent missing usage data.** Many usage tools estimate tokens and convert them into a confident-looking number. COMPANION distinguishes native provider data from derived values and leaves unsupported data blank.
2. **The privacy boundary is reviewable.** The code, permissions, storage categories, network behavior, and threat model are documented directly.
3. **The same local tools follow the user across providers.** Claude and ChatGPT retain separate adapters, while the user gets one consistent extension and settings surface.
4. **It treats provider changes as a reliability problem.** Freshness labels, expiry, strict schemas, and provider-specific code paths reduce the chance of stale or cross-provider data appearing current.

## Maker quote

> “I built COMPANION around a rule I wish more AI usage tools followed: native numbers or nothing. If a provider does not expose a trustworthy value, the honest product decision is to say that, not to turn an estimate into a fact. Privacy had to be structural too, which is why there is no backend, analytics, or raw OpenAI response collection.”
>
> Zack Brenner, creator of COMPANION

## Maker bio

Zack Brenner is an independent builder focused on practical, privacy-conscious AI tools. He studies law and business in San Diego and works across product, operations, and legal technology.

## Frequently asked questions

### Is COMPANION affiliated with Anthropic or OpenAI?

No. COMPANION is independent and unofficial. Claude, ChatGPT, Work, and Codex are trademarks of their respective owners.

### Does it work on every Claude or ChatGPT plan?

The interface and local tools work on supported web composers. Usage rows depend on the native data each provider exposes to the signed-in account. Different plans and surfaces can expose different fields.

### Does it estimate ChatGPT usage?

No. COMPANION renders supported numeric fields that OpenAI exposes in first-party page responses. When no supported field appears, it shows an empty state.

### Are Claude token figures exact?

Claude dollar figures come from Claude's native usage-credit counter. Token figures derived from those dollars are presented as ranges rather than false precision.

### Does it read chats?

Prompt text is handled transiently only when the user enables Lifejacket Mode and initiates a local preview. It is not stored or transmitted by COMPANION. Provider reply text is not collected.

### Does it upload files?

COMPANION does not upload files to a developer server. User-selected files are parsed locally inside a no-network sandbox. The user chooses what Markdown enters the provider composer.

### Why does it need host permissions?

It must run the widget and provider-specific usage adapter on the exact Claude and ChatGPT web origins. It does not request access to every website.

### Why does it need `alarms`?

A bounded Chrome alarm removes a stale high OpenAI toolbar warning after two hours, even when every ChatGPT tab has closed. The alarm contains no account or content data.

### Does it work in the standalone Codex desktop app?

No. A Chrome extension cannot inject into a native desktop shell that does not host Chrome extensions. COMPANION supports ChatGPT Chat and Work on the web, with narrow legacy Codex route compatibility when such a route appears.

### How is it funded?

At v1.4.0, COMPANION is released as a free independent project. Do not publish a different funding claim unless the model changes.

## Suggested story angles

- A usage extension that refuses to show a number when the provider exposes none
- How to normalize AI account data without moving raw responses across the extension boundary
- A privacy-first extension with no developer backend or telemetry
- One local workflow layer across Claude, ChatGPT Chat, and ChatGPT Work
- Why local file conversion belongs in a no-network sandbox
- Designing honest freshness and expiry for provider usage data

## Asset map

### Brand

- Orbit C source: `icons/orbit-c.svg`
- Store icon: `icons/icon128.png`
- Social card: `docs/launch/assets/social-card-1200x630.png`

### Chrome Web Store

- `store/promo-tile-440x280.png`
- `store/marquee-1400x560.png`
- `store/screenshots/01-overview.png`
- `store/screenshots/02-claude-usage.png`
- `store/screenshots/03-chatgpt-work-codex.png`
- `store/screenshots/04-settings-privacy.png`
- `store/screenshots/05-local-efficiency-tools.png`

### Product Hunt

- `docs/launch/assets/product-hunt-thumbnail-240x240.png`
- `docs/launch/assets/product-hunt-gallery-01-1270x760.png`
- `docs/launch/assets/product-hunt-gallery-02-1270x760.png`
- `docs/launch/assets/product-hunt-gallery-03-1270x760.png`

## Contact

- Maker and press contact: `zgbrenner@gmail.com`
- Source and documentation: `https://github.com/zgbrenner/claudecompanion` after the repository becomes public
- Chrome Web Store: add the approved public URL before launch

## Usage notes for writers and creators

- Set **COMPANION** in all caps.
- Do not describe the product as an Anthropic or OpenAI partner.
- Do not imply universal ChatGPT usage visibility.
- Do not use provider logos as COMPANION branding.
- Do not call the standalone Codex desktop application supported.
- Use current product screenshots rather than recreating the interface.
