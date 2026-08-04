# Chrome Web Store Listing — COMPANION

Ready-to-paste copy for the Chrome Web Store developer dashboard.

## Extension name

```text
COMPANION
```

## Summary

Chrome Web Store summaries must be 132 characters or fewer.

**Character count: 131 / 132**

```text
See native Claude and ChatGPT usage, compress prompts locally with Lifejacket Mode, and keep prompts and files private.
```

## Detailed description

Chrome Web Store descriptions are plain text. Paste the text inside the block below.

```text
COMPANION is a private, local usage and efficiency layer for Claude and ChatGPT.

It docks beside the active chat composer, follows the page theme, and automatically adapts to Claude, ChatGPT Chat, ChatGPT Work, and Codex-aware web surfaces. There is no provider switch and no COMPANION account.

NATIVE NUMBERS OR NOTHING

▪ On Claude, COMPANION shows usage information Claude exposes to the signed-in account, including usage-credit spend, rolling session and weekly limits, Opus usage when reported, reset times, and local spend history.

▪ On ChatGPT web surfaces, COMPANION shows only recognized numeric usage, quota, credit, limit, reset, or token fields that OpenAI exposes in first-party page responses.

▪ When a provider does not expose a trustworthy number, COMPANION says it is waiting for native data. It does not estimate a quota, scrape replies, or present a guess as fact.

LIFEJACKET MODE

Lifejacket is optional and off by default. It has one master switch and three independently saved tools.

▪ SHORTEN THE USER'S PROMPT

When enabled, a bundled MobileBERT LLMLingua-2-style Q8 model runs locally before every supported non-empty send. Model weights and the CPU/WASM runtime ship inside the extension. Nothing is downloaded at runtime.

Before accepting a result, Lifejacket protects code, links, email addresses, quotations, numbers, structured rows, negation, obligations, and bounds. It keeps the original when compression is unsafe, ineffective, poorly covered by the tokenizer, or unsuccessful.

Every intercepted send opens an editable preview with Send optimized, Send original, and Cancel. Nothing is silently submitted.

▪ ASK FOR SHORTER ANSWERS

A separate control adds one visible instruction to the end of the final prompt asking for a brief answer without dropping necessary facts, steps, or caveats. This can be used with prompt compression on or off.

▪ CONVERT FILES TO MARKDOWN

Lifejacket converts supported PDF, Office, OpenDocument, RTF, CSV, HTML, Markdown, and text files locally. Untrusted document parsing occurs in a no-network sandbox before Markdown is appended to the current draft. Files are not uploaded to COMPANION or retained.

LIMIT ALERTS

▪ Optional toolbar badges and desktop notifications provide a heads-up when a trustworthy native limit reaches 85% or 95%.

▪ Per-metric controls let users hide individual Claude metrics, the in-page widget, Lifejacket Mode, notifications, or the always-visible toolbar badge.

PRIVATE BY DESIGN

▪ No COMPANION account.
▪ No analytics, telemetry, advertising, trackers, or developer backend.
▪ No runtime model or executable-code downloads.
▪ Prompts and replies are never stored by COMPANION.
▪ Raw OpenAI account responses remain in the ChatGPT page. Only bounded normalized numeric usage fields cross into the extension.
▪ User-selected files are parsed locally and are not retained.
▪ Settings, numeric usage history, normalized usage snapshots, and small operational caches stay in browser storage until cleared or the extension is uninstalled.
▪ Host access is limited to exact Claude and ChatGPT HTTPS origins. There is no access to every website and no broad browsing-history permission.

SUPPORTED SURFACES

▪ Claude.ai
▪ ChatGPT Chat
▪ ChatGPT Work
▪ Codex-aware routes and shared agentic usage exposed on ChatGPT web

The native Codex desktop shell is not a Chrome extension host, so COMPANION cannot inject into that application. It supports Codex-aware web surfaces and numeric data OpenAI exposes through ChatGPT web.

COMPANION is an independent, unofficial project. It is not affiliated with, endorsed by, sponsored by, or produced by Anthropic, OpenAI, Microsoft, Hugging Face, or the model author. Product and model names remain the property of their respective owners.
```

## Category

**Productivity**

COMPANION helps users monitor provider-reported limits, reduce avoidable prompt and reply length, and convert files efficiently while they work.

## Language

English (United States)

## Support links

Before public submission, confirm that these destinations are publicly accessible:

- Privacy policy: `store/privacy-policy.md`
- Reviewer instructions: `store/test-instructions.md`
- Security architecture: `docs/SECURITY.md`
- Lifejacket architecture: `docs/LIFEJACKET_MODE.md`
- Issue tracker: GitHub Issues after the repository becomes public

## Store assets

Upload:

1. `icons/icon128.png`
2. `store/screenshots/01-overview.png`
3. `store/screenshots/02-claude-usage.png`
4. `store/screenshots/03-chatgpt-work-codex.png`
5. `store/screenshots/04-settings-privacy.png`
6. `store/screenshots/05-local-efficiency-tools.png`
7. `store/promo-tile-440x280.png`
8. `store/marquee-1400x560.png` when completing the optional marquee field

Do not add awards, rankings, install counts, review counts, provider logos, or affiliation language unless they are factual and current at submission time.
