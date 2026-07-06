# Vistage Claude Usage Companion

An internal tool for **Vistage Worldwide, Inc.** — a privacy-first Chrome/Edge browser extension that gives Vistage staff a simple estimate of how much Claude they are using while they work, pinned right under the chat box.

The extension can display usage as:

- **Dollars** — API-equivalent estimated spend, useful for anyone thinking in budgets.
- **Tokens** — useful for technical users and admins.
- **Both** — dollars and tokens together.

> Important: Claude.ai subscriptions are not literally billed per token unless the user or organization enables usage credits or uses API-style billing. This extension therefore shows **API-equivalent estimated cost**, not a guaranteed invoice amount.

## What it tracks

- Estimated input tokens from user prompts.
- Estimated output tokens from Claude responses.
- Estimated conversation/context weight.
- Session usage for Claude's rolling usage-window style.
- Daily and monthly estimates.
- **Native session/weekly/Opus limits, read directly from Claude.ai's own usage endpoint** — not an estimate. See "Native limits" below.

## Native limits (ground truth, not an estimate)

Alongside the dollar/token estimate, the widget shows Claude's own 5-hour session, weekly, and weekly-Opus usage percentages, pulled from an internal Claude.ai endpoint the same way Claude's own settings page does. This is exact, not approximated — it's the same data Anthropic shows you, just without leaving your chat.

How it works:
- Discovers your organization ID via `GET /api/organizations` (cached 24h in `chrome.storage.local`).
- Polls `GET /api/organizations/{orgId}/usage` every 60 seconds and on tab focus.
- Your session cookie rides along automatically because the request originates from a content script running on a claude.ai page — the extension never reads, stores, or transmits the cookie itself.

Caveats, stated plainly:
- This endpoint is **undocumented** and could change shape or disappear without notice. If it breaks, the native limits section shows an error and the dollar/token estimate above keeps working normally — the two are independent.
- On team/enterprise accounts with multiple organizations, org auto-detection picks the first one returned, which may not be the one you're actively using. Use "Clear cached organization" in Settings to force re-detection.
- This is read-only. The extension makes no request that could modify your account, conversations, or organization settings.

## Target users

Built for Vistage Worldwide, Inc. staff using Claude.ai — not aimed at developers, so the widget stays simple: one dollar/token figure, a daily budget bar, and Claude's own native limits.

## Install locally

1. Open Chrome or Edge.
2. Go to `chrome://extensions`.
3. Enable **Developer mode**.
4. Click **Load unpacked**.
5. Select this project folder.
6. Open `https://claude.ai`.

## Widget position

By default the widget docks in the page itself, right under the chat composer — not a floating overlay. Drag its header to move it anywhere on screen; once dragged, it switches to floating mode and remembers where you left it (persisted in `chrome.storage.local`). Use "Reset widget to default position" in Settings to snap it back under the chat box.

If Claude.ai's page structure changes and the composer can't be found, the widget automatically falls back to floating in the bottom-right corner rather than not appearing at all.

## Files

```text
manifest.json              Chrome extension manifest
src/content.js             Injects the in-page widget, docking/drag logic, and local estimator
src/content.css            Widget styles
src/injected.js            Page-context network/SSE observer
src/native-usage.js        Reads Claude's own /usage endpoint (ground truth, not estimated)
src/o200k_base.js          Vendored tokenizer (gpt-tokenizer's o200k_base build)
src/background.js          Extension message bridge
src/popup.html             Toolbar popup UI
src/popup.css              Popup styles
src/popup.js               Popup logic
src/options.html           Settings page
src/options.css            Settings styles
src/options.js             Settings logic
src/shared.js              Shared defaults and pricing helpers
```

## Design principles

1. **Do not store prompt text.** The extension briefly reads prompt/response text only to estimate counts, then discards the text.
2. **Keep everything local.** Usage data is stored in `chrome.storage.local`.
3. **Use human-facing units first.** Dollar estimates and budget language are more useful than token jargon for most nontechnical users.
4. **Be honest about uncertainty.** Browser-side Claude.ai usage tracking is approximate because Claude.ai does not expose full billing-grade token usage to browser extensions — except for the native limits section, which reads Claude's own numbers directly.
5. **Prefer explainability.** Instead of just showing a number, explain why usage may be high.

## Current pricing assumptions

Pricing lives in `src/shared.js`. Update it whenever Anthropic changes API pricing.

The defaults use public Anthropic API-equivalent model pricing in USD per million tokens. These prices are used only to estimate economic weight, not to claim actual Claude.ai subscription charges.

## Token counting accuracy

The extension uses a real tokenizer (`src/o200k_base.js`, from the `gpt-tokenizer` npm package, OpenAI's `o200k_base` encoding) when it can, falling back to a character/word heuristic if that file is ever removed. Read this carefully: **this is still not an exact Claude token count.** There is no public Claude tokenizer — Anthropic's is proprietary and unpublished, so no JavaScript library, including well-regarded ones like `gpt-tokenizer`, can produce exact Claude counts. What the vendored tokenizer gets you is a meaningfully closer approximation than char/word counting, using a different model's vocabulary. The widget footer labels which method produced the number ("tokenizer estimate" vs. "rough estimate") so this distinction stays visible rather than implied away.

## Recommended next improvements

- Add import/export of local usage history as CSV.
- Add organization policy presets, for example: “warn after $3/day” or “default to Sonnet for ordinary work.”
- Add a small on-device classifier to label sessions as HR, marketing, legal, research, coding, or general admin without storing text.
- Add a “why did this cost so much?” drilldown that explains context, attachments, output length, and model choice.
- Read the actual conversation message tree (like Claude's own API returns) instead of scraping composer text, for more reliable per-conversation token totals.

## Changelog

### 0.4.0

**Branding:** This is now explicitly labeled throughout as an internal Vistage Worldwide, Inc. tool — extension name, popup, options page, and widget header.

**Widget positioning:**
- The widget now docks in the page itself, right under the chat composer, by default — not a floating overlay. Verified against `[data-testid="chat-input-grid-container"]`.
- Dragging the header switches it to floating mode and remembers the dropped position; "Reset widget to default position" in Settings snaps it back under the chat box.
- If the composer can't be found (page still loading, or Claude.ai changed its markup), the widget fails safe into floating mode rather than not appearing.

**Widget simplified:**
- Replaced the dual dollar/token metric cards with one main figure (dollars, tokens, or both inline, depending on your display setting) plus one progress bar — matching the "very simple, easy to read" goal.
- Same simplification applied to the toolbar popup for consistency.

**Settings simplified:**
- Removed the "Team profile" (HR/marketing/legal/operations) dropdown — it was stored but never actually affected any behavior in the code.
- Removed session/monthly budget views and their input fields; the widget always shows daily budget now, which is the framing people actually use day to day.
- Removed the context-carry-forward-ratio, safety-margin, and other power-user estimation knobs from the visible settings page. The underlying values are unchanged (see `src/shared.js` `DEFAULT_SETTINGS`) — they're just no longer exposed as adjustable UI, to keep Settings to what people actually need: display mode, model, daily budget, and native limits.

**Tokenizer now active:** the vendored `src/o200k_base.js` (`gpt-tokenizer`'s `o200k_base` build, verified via a real npm-lockfile-backed package rather than hand-transcribed) is wired in as of this version. See "Token counting accuracy" above for what this does and doesn't mean.

### 0.3.0

**Native limits (new):**
- Added a "Native limits" section reading Claude.ai's own `/usage` endpoint directly — real session/weekly/Opus percentages and reset countdowns, not estimates. Shown in the in-page widget, the toolbar popup, and configurable in Settings. This sits alongside the existing dollar/token estimate rather than replacing it, since the two answer different questions (budget-style estimate vs. Claude's own limit tracking).
- Added "Clear cached organization" in Settings for team/enterprise accounts where org auto-detection might pick the wrong one.
- This integration is informed by patterns confirmed in other actively-maintained open-source Claude.ai extensions (she-llac/claude-counter, sshnox/Claude-Usage-Tracker) — both independently use the same endpoint shape, which gives reasonable confidence it's real and stable-ish, though it remains an undocumented Anthropic-internal endpoint that could change.

**Selector accuracy:**
- Replaced several guessed `data-testid` selectors with verified ones (`[data-testid="model-selector-dropdown"]`, `[data-testid="chat-input-grid-container"]`) confirmed against a live, actively-maintained claude.ai-targeting extension. Guessed selectors remain as fallbacks, not replacements, since only these two are independently confirmed.

**Token counting:** added loader scaffolding for a vendored real tokenizer (OpenAI's `o200k_base`, via the `gpt-tokenizer` library) — not yet wired in as of this version. See 0.4.0 above for activation.

### 0.2.0

**Accuracy fixes:**
- Context carry-forward no longer compounds on its own prior estimate. The old code multiplied the *cumulative running total* (which already included prior carry-forward) by the ratio on every message, producing runaway numbers — in testing, ~2.5M phantom context tokens by turn 15 of an ordinary conversation. It now tracks raw per-turn input separately and caps the estimate at 200K tokens (the realistic context-window ceiling).
- Attachment detection is now scoped to the composer area with a narrower selector set. The previous `[class*='file' i]` selector matched any element with "file" as a class substring anywhere on the page and could overcount by tens of thousands of phantom tokens.
- Send detection (Enter key and send-button clicks) is now scoped to the composer. Previously any Enter press or any button labeled with "arrow" anywhere on the page could be misread as sending a prompt.
- Model detection now prefers scoped model-picker elements over a blind scan of page text, reducing false positives from model names mentioned in chat history.
- Sonnet 5 pricing now auto-resolves from intro to standard pricing after Aug 31, 2026, rather than relying on someone manually switching a dropdown.
- Added SPA navigation handling — Claude.ai doesn't reload the page when switching chats, so conversation-scoped stats and the widget's model readout previously could go stale until a full reload.

**Widget changes:**
- Removed the "This looks like a heavy prompt…" line from the in-page widget.
- Footer now shows the selected model, detected effort level (when found), and a pricing-accuracy note ("Accurate till 8/31/26" for intro pricing, "Pricing current" otherwise) instead of "Local only."
- Widget is now draggable by its header and can be collapsed to a compact bar; both position and collapsed state persist across reloads.

**Known limitations, stated plainly:** model, effort, and attachment detection rely on guessed `data-testid`/`aria-label` patterns since Claude.ai's DOM isn't documented for extensions. These are best-effort heuristics, not verified against Claude.ai's live markup — if they stop matching, the extension fails safe (undercounts to zero or falls back to the default model) rather than silently overcounting.
