# Vistage Claude Usage Companion

An internal tool for **Vistage Worldwide, Inc.** — a privacy-first Chrome/Edge browser extension that gives Vistage staff a simple estimate of how much Claude they are using while they work, pinned right under the chat box.

The extension can display usage as:

- **Dollars** — API-equivalent estimated spend, useful for anyone thinking in budgets.
- **Tokens** — useful for technical users and admins.
- **Both** — dollars and tokens together.

> Important: Claude.ai subscriptions are not literally billed per token unless the user or organization enables usage credits or uses API-style billing. This extension therefore shows **API-equivalent estimated cost**, not a guaranteed invoice amount.

## What it tracks

- Estimated input tokens from user prompts (including retries and edit-and-resend, observed from generation requests).
- Estimated output tokens from Claude responses.
- Estimated usage in the current chat, plus today's and this month's estimated spend (popup).
- **Claude's real limits, read directly from Claude.ai's own usage endpoint** — not an estimate: the 5-hour session limit, the weekly limit, the weekly Opus limit (when applicable), and the monthly usage-credit allowance, each with a reset countdown. See "Native limits" below.

## Native limits (ground truth, not an estimate)

Alongside the current-chat dollar/token estimate, the widget and popup show Claude's own rolling limits — the 5-hour session limit that actually locks people out mid-workday, the weekly limit, the weekly Opus limit, and the monthly usage-credit spend limit — pulled from internal Claude.ai endpoints the same way Claude's own settings page does. This is exact, not approximated — it's the same data Anthropic shows you, just without leaving your chat. A plain-English warning appears at 80%+ utilization, and the toolbar icon shows a badge so you get warned even with the widget hidden.

How it works:
- Discovers your organization ID from the `lastActiveOrg` cookie on claude.ai (the org you're actively using), falling back to `GET /api/organizations` (cached 24h in `chrome.storage.local`).
- If `organizationId` is configured in Settings, uses that organization directly instead of auto-discovery. If Claude answers 403 for a configured/cached org (wrong org for this account), the extension re-discovers automatically instead of telling you to sign in.
- Polls `GET /api/organizations/{orgId}/usage` and `GET /api/organizations/{orgId}/overage_spend_limit` every 60 seconds and on tab focus; open tabs share one poll via storage instead of each fetching independently, and a `message_limit` frame in Claude's own response stream triggers an immediate (throttled) refresh.
- Your session cookie rides along automatically because the request originates from a content script running on a claude.ai page — the extension never reads, stores, or transmits the cookie itself.

Caveats, stated plainly:
- This endpoint is **undocumented** and could change shape or disappear without notice. If it breaks, the native limits section shows an error and the dollar/token estimate above keeps working normally — the two are independent.
- On team/enterprise accounts with multiple organizations, org auto-detection picks the first one returned, which may not be the one you're actively using. Use "Clear cached organization" in Settings to force re-detection.
- This is read-only. The extension makes no request that could modify your account, conversations, or organization settings.

## Target users

Built for Vistage Worldwide, Inc. staff using Claude.ai — not aimed at developers, so the widget stays simple: current chat usage and the enterprise limit.

## Install locally

1. Open Chrome or Edge.
2. Go to `chrome://extensions`.
3. Enable **Developer mode**.
4. Click **Load unpacked**.
5. Select this project folder.
6. Open `https://claude.ai`.

## Widget position

The widget docks in the page itself, right under the chat composer. It is not draggable and does not have a floating mode.

If Claude.ai's page structure changes and the composer can't be found, the widget waits until it can find the composer again rather than floating somewhere else.

## Files

```text
manifest.json              Chrome extension manifest
icons/                     Toolbar/notification icons
src/content.js             Injects the in-page widget, docking logic, and local estimator
src/content.css            Host-level docking styles (widget internals are shadow-DOM scoped)
src/widget.css             Widget styles, injected inside the widget's shadow root
src/injected.js            MAIN-world network/SSE observer (fetch + XHR patches)
src/native-usage.js        Reads Claude's own /usage endpoint (ground truth, not estimated)
src/o200k_base.js          Vendored tokenizer (gpt-tokenizer's o200k_base build)
src/background.js          Extension message bridge + periodic update checks
src/updater.js             GitHub-pull self-updater (hash-verified, File System Access API)
tools/build-update-manifest.mjs  Generates update/manifest.json (file list + SHA-256)
update/manifest.json       Update feed the extension polls (regenerated by CI)
src/popup.html             Toolbar popup UI
src/popup.css              Popup styles
src/popup.js               Popup logic
src/options.html           Settings page
src/options.css            Settings styles
src/options.js             Settings logic
src/shared.js              Shared defaults and pricing helpers
```

## Updates

Updates install straight from GitHub — no Chrome Web Store, no uninstall/reinstall, and all settings are kept.

How it works:

1. Every push to `main` regenerates `update/manifest.json` (version + SHA-256 hash for every shipped file) via the `publish-update-manifest` GitHub Action.
2. The extension's background worker checks that manifest every ~6 hours (from `raw.githubusercontent.com`, falling back to the jsDelivr CDN). When a newer version exists, a blue "Update vX.Y.Z is ready — click to install" banner appears at the top of the widget, and the Settings page shows an **Install update** button.
3. **One-time setup per user:** in Settings → Updates, click **Connect extension folder** and pick the folder the extension was loaded from (the same folder chosen at `chrome://extensions` → Load unpacked). This uses the browser's File System Access API; the permission persists.
4. Installing an update downloads every file listed in the manifest, verifies each SHA-256 **before anything is written** (a failed download or hash mismatch aborts with zero changes), writes the files (`manifest.json` last), and reloads the extension. Chrome re-reads unpacked extension files on reload, so the new version is live immediately with the same extension ID and stored settings.

To publish an update: bump `version` in `manifest.json`, merge to `main`, and the Action does the rest. (You can also run `node tools/build-update-manifest.mjs` locally and commit the result.)

Optional: to serve updates from Cloudflare Pages instead of GitHub raw/jsDelivr (e.g. if the repo goes private), connect the repo to a Cloudflare Pages project (no build step; output directory = repo root) and set `updateBaseUrl` in the extension settings (`cuc:settings.updateBaseUrl`) to the Pages URL.

Caveat: an update that adds new manifest permissions may require a one-time manual reload (or in rare cases remove/re-add) at `chrome://extensions` — Chrome doesn't always apply permission changes from a self-reload. Ordinary code updates apply cleanly.

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

The extension uses a real tokenizer (`src/o200k_base.js`, from the `gpt-tokenizer` npm package, OpenAI's `o200k_base` encoding) when it can, falling back to a character/word heuristic if that file is ever removed. Read this carefully: **this is still not an exact Claude token count.** There is no public Claude tokenizer — Anthropic's is proprietary and unpublished, so no JavaScript library, including well-regarded ones like `gpt-tokenizer`, can produce exact Claude counts. What the vendored tokenizer gets you is a meaningfully closer approximation than char/word counting, using a different model's vocabulary.

## Recommended next improvements

- Add organization policy presets, for example: “warn after $3/day” or “default to Sonnet for ordinary work.”
- Add a small on-device classifier to label sessions as HR, marketing, legal, research, coding, or general admin without storing text.
- Add a “why did this cost so much?” drilldown that explains context, attachments, output length, and model choice.
- Read the actual conversation message tree (like Claude's own API returns) instead of scraping composer text, for more reliable per-conversation token totals.
- A snooze control on desktop warnings, and optional quiet hours.
- A replayable “what do these numbers mean?” first-run walkthrough.

## Changelog

### 0.7.0

- **Output tracking fixed at the root:** the network watcher is now a manifest-declared `world: "MAIN"` content script at `document_start`, so `fetch`/`XMLHttpRequest` are patched before any claude.ai code can capture the originals (the old async `<script src>` injection raced the app bundle and lost, which silently killed response/output counting). XHR-based streams are now covered too.
- Generation detection no longer depends on a hardcoded URL pattern: any claude.ai POST answered with an event-stream response counts, with a `console.debug` breadcrumb when the path doesn't match known patterns (visible drift instead of silent breakage).
- `message_limit` frames in generation streams are now parsed (sanitized utilization + reset only) and merged live into the native-limits display — fresher than the 60s poll.
- **Self-updates from GitHub:** blue in-widget banner when a newer version is on `main`; one-time "Connect extension folder" setup in Settings, then updates are one click — hash-verified downloads, nothing written unless every file verifies, automatic extension reload. CI regenerates `update/manifest.json` on every push to main.
- Widget docks below the visual chat box (not inside it) and always matches its width; follows Claude's own light/dark theme instead of the OS; condensed layout; renamed to "Vistage · Claude Companion".

### 0.6.0

Built from the v0.5.0 roadmap plus a second, deliberately broad open-source research pass — not just Claude-tracker projects but extension-engineering frameworks (Plasmo, wxt.dev, Bitwarden's inline UI), burn-rate forecasting tools (ccusage's blocks math, Claude-Code-Usage-Monitor's trailing-window smoothing and prediction phrasing), tiny-visualization patterns (fnando/sparkline, GitHub-contribution graphs), digital-wellbeing nudge extensions, and budget-app pacing language (Actual Budget, Firefly III).

**Pace projection (new):**
- The widget and popup now answer the question that matters most before lunch: *“At this pace, you'll hit your session limit around 3:45 PM (estimated).”*
- Computed from a trailing window of session-limit samples (shared across tabs), never a jumpy two-point delta; requires ≥3 samples over ≥5 minutes and a genuinely rising slope before it says anything.
- The key rule, borrowed from Claude-Code-Usage-Monitor: if the 5-hour window resets **before** the projected depletion, no warning is shown at all — the reset will save you, so there's nothing to worry about. Warnings always carry “(estimated)” and day-relative times (“tomorrow 9:15 AM”).

**Shadow DOM widget isolation (new):**
- The in-page widget now renders inside a shadow root: claude.ai's global styles can no longer bleed into it (and its styles can't leak out), making it far more robust against claude.ai redesigns.
- claude.ai's `html.dark` class is mirrored onto the shadow host (observed live), with `prefers-color-scheme` as the system-level fallback — dark mode keeps working in both directions.
- Widget styles moved from the page-level `content.css` into `src/widget.css`, injected inside the shadow root via constructable stylesheets (with a `<style>` fallback); `content.css` now carries only host-level docking rules.

**Desktop warnings (new):**
- A gentle desktop notification when any limit crosses 85% or 95% — once per threshold per reset window, deduped across tabs, never repeated nagging. Toggle in Settings (“Warnings”); the toolbar badge is unaffected.
- The extension finally has real icons (16/32/48/128) — a green meter mark in the toolbar instead of the generic puzzle piece — which the notifications also use.

**14-day trend (new):**
- The popup shows a small bar trend of daily estimated spend (last 14 days, today highlighted), rendered with plain flexbox — no chart library. Hidden until there are at least two active days, so a fresh install isn't greeted by an empty chart.

**Learnability:**
- Every limit label in the widget and popup has a plain-English hover explanation (“This is the limit that pauses you mid-day. Read from Claude directly — not an estimate.”).
- First-run empty state in the popup: “No usage tracked yet — send Claude a message to start.”

**Efficiency:**
- The cross-tab native-usage cache and pace samples moved from `chrome.storage.local` to `chrome.storage.session` (memory-backed, self-clearing on browser restart, no disk write per poll), with the background granting content-script access and a transparent local fallback for older Chrome.

### 0.5.0

The headline: the extension already fetched Claude's real 5-hour/weekly limit data on every poll but never displayed it — the numbers that actually lock someone out mid-workday. This release shows them. Informed by an audit of this codebase plus a review of open-source Claude usage trackers (she-llac/claude-counter, sshnox/Claude-Usage-Tracker, lugia19/Claude-Usage-Extension, ryoppippi/ccusage).

**Claude's real limits, now visible (widget + popup):**
- Session limit (5-hour), Weekly limit, and Weekly Opus limit bars with live reset countdowns (“resets in 1h 20m”), color-coded at 70%/90%. The Opus row hides itself at 0% to keep the widget calm for non-Opus users.
- Plain-English warning at ≥80% on any limit (“Session limit almost used up — it resets in 42m.”).
- Toolbar icon badge (amber ≥80%, red ≥90%) so a warning reaches people even when the widget is hidden.
- “Enterprise limit” renamed to “Monthly allowance.”

**Daily/monthly spend finally visible:**
- Popup shows “Today (estimate)” and “This month (estimate)” from the daily buckets that were always tracked but never rendered.
- Settings gains “Download CSV” — one row per day (counts and dollar estimates only, never chat text).

**Accuracy:**
- Retries, edit-and-resend, and other non-composer sends are now counted as input: the network watcher reports the generation request's prompt length (characters only — the text never crosses the page event bus).
- Request bodies are captured before fetch consumes them, so model detection works for `Request`-object calls too.
- The network watcher installs immediately at `document_start` instead of after settings load, so the earliest generation on a fresh page isn't missed.
- Enter during IME composition (Japanese/Chinese/Korean input) no longer records phantom sends.
- The footer model label resolves intro→standard pricing the same way the math does, so it can't claim intro pricing after the cutoff.
- Manual “Reset usage estimates” now also clears per-chat estimates (visible effect); the automatic 5-hour rollover still preserves them. Resets carry the idempotency ring buffers through, closing a double-count window.
- A future storage schema bump now salvages days/months/conversations history instead of silently wiping it.

**Wrong-org handling:**
- Org auto-discovery prefers claude.ai's `lastActiveOrg` cookie (the org you're actually using) before falling back to the organizations list.
- 403 is no longer reported as “sign in to claude.ai”: a wrong configured/cached org triggers automatic re-discovery, and if that fails the message says to check the Organization ID setting. A member-level 403 on the optional `overage_spend_limit` endpoint no longer discards the session/weekly data already fetched.

**Efficiency:**
- Multiple open claude.ai tabs now share one usage poll through storage (fresh-within-45s reuse) instead of each polling independently — less traffic, less org-wide 429 exposure.
- The 2-second widget re-dock poll is replaced with a throttled MutationObserver: zero work on a quiet page.
- A `message_limit` frame observed in Claude's own response stream triggers an immediate throttled refresh, so the bars update right after each send.

**Security/robustness:**
- Page-world network events now carry a per-load handshake token; the content script drops events without it, so page scripts can't forge usage events.
- Widget insertion into React-managed DOM is guarded against mid-reconciliation failures.

**Accessibility & polish:**
- Progress bars expose `role="progressbar"` with live values; icon buttons have real labels; key values announce via `aria-live`.
- The display-mode button shows the current mode ($ / # / $#) instead of always “$”.
- The popup no longer mislabels the shared new-chat bucket as “this chat” when no claude.ai tab is available.
- “Check for updates” shows a link instead of auto-opening GitHub; the org-ID warning is dark-mode aware; removed dead settings (`monthlyBudgetUsd`, `sessionBudgetUsd`, `planName`, `priceBasisLabel`) and ~100 lines of orphaned CSS.

### 0.4.4

**Stream parsing accuracy (multi-agent audit fixes):**
- SSE frames split across network chunks are now buffered and reassembled instead of silently dropped, and stream events are parsed by type: only true deltas (`content_block_delta`, legacy `completion`) are counted, while full-message snapshots (`message_start`, `content_block_start`) are ignored. Unknown event shapes still fall back to conservative extraction.
- Legitimately repeated text in delta streams is no longer removed by overlap dedup.

**Attribution accuracy:**
- Output is attributed to the conversation and model captured when the generation request starts (from the request URL/body), so navigating mid-stream no longer books a response to the wrong chat.
- Detected models are tracked per conversation instead of one sticky global, so a Sonnet chat no longer inherits Opus pricing from another tab's chat.
- Prompts sent in a brand-new chat (before a conversation id exists) are migrated into the real conversation bucket once it is known.

**Enterprise limit:**
- A cap that differs from the expected employee limit is now displayed with an advisory note instead of being hidden, unless it looks like a cents/dollars unit mismatch (~100x off), which is still rejected with a distinct message.
- 429 responses trigger exponential poll backoff (up to 10 minutes) and poll intervals are jittered so multiple tabs do not fire in lockstep.
- The bar shows an approximate monthly reset date ("resets ~Aug 1") when Claude's payload carries no reset timestamp.

**UI:**
- Dark mode support for the widget, popup, and settings page (follows claude.ai's dark class and the system color scheme).
- Composer docking gains a fallback that anchors near the ProseMirror editor when claude.ai's test ids change, still never floating.
- Settings validates the organization ID as a UUID (non-blocking warning).

### 0.4.3

**Requested corrections:**
- Enterprise limit now prefers Claude's member-visible `usage.extra_usage` bucket and rejects caps that do not match the configured employee monthly limit (`$100` by default), preventing the org-wide `$5000` cap from being displayed as an employee cap.
- Removed the daily self-limit tracker from the widget, popup, and settings.
- Removed all widget dragging, collapsing, saved position, and floating fallback behavior. The widget only docks under the composer.
- Disabled hidden context carry-forward by default and reset local usage storage to version 2, so old overestimated chat totals do not carry forward.

### 0.4.2

**Widget reduced to two bars:**
- Usage in this chat — a local dollar/token ballpark estimate scoped to the active conversation.
- Enterprise limit — the employee monthly usage-credit spend and limit from Claude.ai's usage data. The extension refuses to display an org-wide cap such as `$5000` as the employee limit when the configured employee cap is `$100`.

**Accuracy and model detection:**
- Model detection now listens to Claude generation request payloads when available, then falls back to the visible model picker.
- Toolbar popup asks the active claude.ai tab for its conversation id/state so "this chat" does not accidentally render as a popup-local page.
- Docked widget re-checks that it is still directly under the composer after Claude.ai React rerenders.
- Enterprise limit now means the organization's monthly usage-credit spend cap, not Claude's rolling weekly utilization meter.
- Added an explicit organization id setting; Vistage's org id defaults to `1e16048b-a724-40fd-b78b-bcf3c7f9af9a`.
- Removed daily self-limit tracking and all widget dragging/floating behavior.
- Reset local usage storage to version 2 so old overestimated chat totals do not carry forward.

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
