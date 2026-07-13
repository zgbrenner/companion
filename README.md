# Claude Companion

A privacy-first Chrome/Edge browser extension that shows you how much Claude you are using while you work, pinned right under the chat box.

The extension can display usage as:

- **Dollars** — real usage-credit spend, read from Claude's own counter, accurate to the cent.
- **Tokens** — an approximate range derived from those real dollars using current Anthropic pricing.
- **Both** — dollars and the token range together.

> Since v0.8.0, **every dollar figure is real** — sampled from Claude.ai's own monthly usage-credit counter, never estimated from text. Tokens are the only derived numbers, and they're shown as an honest range rather than a false-precision count.

## What it tracks

- **Spent this session** — Claude's usage-credit counter when you opened your browser vs. now. Covers all your Claude activity in that window (every tab and device on your account), and refreshes right after each response finishes.
- **Today / this month** — daily spend chained from counter samples, plus the month's counter directly. A per-model daily breakdown is used automatically once claude.ai's own Settings → Usage page reveals its endpoint (see "How the numbers work").
- **Claude's real limits, read directly from Claude.ai's own usage endpoint** — the 5-hour session limit, the weekly limit, the weekly Opus limit (when applicable), and the monthly usage-credit allowance, each with a reset countdown. See "Native limits" below.

## Native limits (ground truth, not an estimate)

Alongside the current-chat dollar/token estimate, the widget and popup show Claude's own rolling limits — the 5-hour session limit that actually locks people out mid-workday, the weekly limit, the weekly Opus limit, and the monthly usage-credit spend limit — pulled from internal Claude.ai endpoints the same way Claude's own settings page does. This is exact, not approximated — it's the same data Anthropic shows you, just without leaving your chat. A plain-English warning appears at 80%+ utilization, and the toolbar icon shows a badge so you get warned even with the widget hidden.

How it works:
- Discovers your organization ID from the `lastActiveOrg` cookie on claude.ai (the org you're actively using), falling back to `GET /api/organizations` (cached 24h in `chrome.storage.local`).
- Caches the automatically discovered organization ID in `chrome.storage.local` for 24 hours. The active `lastActiveOrg` cookie is checked first, so switching organizations updates the cache automatically.
- Polls `GET /api/organizations/{orgId}/usage` and `GET /api/organizations/{orgId}/overage_spend_limit` every 60 seconds and on tab focus; open tabs share one poll via storage instead of each fetching independently, and a `message_limit` frame in Claude's own response stream triggers an immediate (throttled) refresh.
- Your session cookie rides along automatically because the request originates from a content script running on a claude.ai page — the extension never reads, stores, or transmits the cookie itself.

Caveats, stated plainly:
- This endpoint is **undocumented** and could change shape or disappear without notice. If it breaks, the native limits section shows an error and the dollar/token estimate above keeps working normally — the two are independent.
- If the active-organization cookie is unavailable and the account belongs to multiple organizations, the `/api/organizations` fallback uses the first returned organization. “Clear detected account cache” forces a fresh lookup.
- This is read-only. The extension makes no request that could modify your account, conversations, or organization settings.

## Target users

Built for people using Claude.ai who think in budgets, not tokens — not aimed at developers, so the widget stays simple: real spend and Claude's own limits.

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
src/injected.js            MAIN-world network observer (model detection, generation-complete signal, message_limit frames)
src/native-usage.js        Reads Claude's own usage endpoints + learned spend-breakdown endpoint
src/background.js          Single-writer for spend baselines, badge/notifications, update checks
src/caveman.js             Caveman Mode: instruction + local prompt trimmer (+ decision docs)
src/offscreen.html/.js     Offscreen file→Markdown conversion service
src/vendor/                Vendored officeparser slim bundle + matching pdf worker
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

### Signing updates (strongly recommended)

The self-updater writes downloaded code into the extension and reloads it, so the update channel is the most security-sensitive part of the tool. Per-file SHA-256 hashes protect against corruption, but the hashes ride in the same manifest as the files — a compromise of the repo, the jsDelivr mirror, or a custom `updateBaseUrl` could serve malicious code *and* matching hashes. To close that, the manifest can be **cryptographically signed** (ECDSA P-256), and the extension refuses any update whose signature doesn't verify. Because the manifest lists every file's hash, one signature authenticates the whole update — and changing any file invalidates it.

Enable it once:

1. `node tools/gen-signing-key.mjs` — prints a public and a private key.
2. Paste the **public** key into `UPDATE_PUBLIC_KEY_SPKI_B64` in `src/updater.js` and commit. From then on, every client on that version enforces signatures.
3. Store the **private** key as the GitHub Actions secret `CUC_UPDATE_SIGNING_KEY` (repo → Settings → Secrets and variables → Actions). Never commit it. The `publish-update-manifest` workflow signs every release with it.

Until a public key is set, updates fall back to hash-only integrity (current behavior). After it's set, publish at least one signed release before older clients update, so the signing secret is in place when the workflow next runs. Lost private key → generate a new pair and ship a new public key.

Only `https` custom update URLs are honored; an `http` base is ignored.

**Commit pinning.** The manifest is fetched from `main` (so new versions are discoverable), but it records the exact commit it was built from, and every file download is pinned to that immutable commit (`raw.githubusercontent.com/.../<commit>/…`, `jsdelivr@<commit>`). Combined with signing — the commit is part of the signed payload — code is only ever pulled from one unchangeable commit the signature vouches for, so a force-pushed or compromised branch can't swap files under a valid manifest, and there's no read-manifest-then-fetch race against `main` advancing.

Optional: to serve updates from Cloudflare Pages instead of GitHub raw/jsDelivr (e.g. if the repo goes private), connect the repo to a Cloudflare Pages project (no build step; output directory = repo root) and set `updateBaseUrl` in the extension settings (`cuc:settings.updateBaseUrl`) to the Pages URL.

Caveat: an update that adds new manifest permissions may require a one-time manual reload (or in rare cases remove/re-add) at `chrome://extensions` — Chrome doesn't always apply permission changes from a self-reload. Ordinary code updates apply cleanly.

## Caveman Mode (v0.9.0)

A red switch at the bottom of the widget for when quota is running low and every token counts. Three things happen when it's on:

1. **Claude replies ultra-brief.** A compact (~100-token) instruction is sent once per conversation: fewest words that fully answer, no preamble/filler/sign-offs, substance and accuracy explicitly protected. In an existing chat it's sent as its own turn when you flip the switch (your unsent draft is preserved and restored); in a brand-new chat it rides on top of your first message so no turn is wasted. Idempotent per conversation — the sent-state is claimed atomically through the background worker and persists across reloads. Because claude.ai officially compacts long conversations (and Anthropic's docs note early instructions lose salience), a one-line reminder is re-pinned to every ~12th message — always visible in the preview, never sent invisibly.
2. **Your prompts get trimmed — with your approval, always.** Sends are intercepted and a preview shows the trimmed prompt (editable), the savings, and the original. Send trimmed, send original, or cancel; nothing is ever auto-sent. Trimming is 100% local, deterministic, and extractive-only — it deletes known filler ("I was wondering if you could…", hedges, politeness scaffolding) and shortens fixed verbose constructions ("in order to"→"to"); it never paraphrases, so meaning can't drift. Code blocks, quotes, URLs, and emails are never touched, and a safety valve returns the original if rules ever remove too much.
3. **Files convert to Markdown.** A drop zone appears in the widget: drop a PDF/DOCX/PPTX/XLSX/CSV/HTML file and it converts to Markdown locally, then lands on your clipboard to paste into the chat (Claude ingests lean Markdown instead of a raw binary). Conversion runs in an offscreen extension page via the vendored `officeparser` slim bundle (the MV3-safe build — no remote code, no OCR engine) with a version-matched local PDF worker. Verified end-to-end in real Chromium against DOCX/PPTX/CSV/PDF samples.

**Decisions and why (researched July 2026, details in `src/caveman.js` comments):**
- *Delivery = direct injection.* Styles are officially being deprecated into Skills, so automating them is a dead end. Skills trigger by model judgment — a trigger phrase can't guarantee activation — and a triggered skill loads its full definition into context anyway, costing at least as much as just sending the instruction. Direct injection costs ~100 tokens once, needs no per-user setup, and is fully verifiable.
- *Compression = hardened rules, not an ML model (for now).* LLMLingua-2's browser port was benchmarked and rejected as a default: the port is experimental with no tests, the public checkpoints are trained solely on meeting transcripts (wrong register for legal/HR prose), it needs a 57–99MB download from huggingface.co — which corporate egress policies commonly block (demonstrated live during our own benchmark) — and WebGPU is often disabled on corporate machines. The rule-based trimmer costs nothing, works offline, measured 28–43% savings on filler-heavy professional prompts, and its known defect classes were fixed under test. An opt-in "deep compression" ML tier remains documented future work.
- *Converter = officeparser slim, sandboxed.* One vendored ESM/IIFE bundle covers PDF/DOCX/PPTX/XLSX/CSV/HTML/RTF/ODT with direct Markdown output (verified at 2.7MB — bigger than its docs suggest, still smaller than stitching four single-format libraries without PDF). The parser runs inside a **manifest-declared sandbox page** (`src/sandbox.html`, opaque origin, no `chrome.*` access, `connect-src` blocks all network egress), hosted by an offscreen document that relays file bytes in and Markdown out over `postMessage`. So even a hypothetical exploit in the third-party parser can't reach extension storage, the network, or your Claude session. PDFs need a pdfjs worker, which a sandboxed opaque origin can't load cross-origin — the offscreen side reads the bundled worker and hands its source to the sandbox to run from a same-origin blob. Verified end-to-end in real Chromium (DOCX/CSV/PDF).

## Design principles

1. **Do not store prompt text.** The extension briefly reads prompt/response text only to estimate counts, then discards the text.
2. **Keep everything local.** Usage data is stored in `chrome.storage.local`.
3. **Use human-facing units first.** Dollar estimates and budget language are more useful than token jargon for most nontechnical users.
4. **Be honest about uncertainty.** Browser-side Claude.ai usage tracking is approximate because Claude.ai does not expose full billing-grade token usage to browser extensions — except for the native limits section, which reads Claude's own numbers directly.
5. **Prefer explainability.** Instead of just showing a number, explain why usage may be high.

## Current pricing assumptions

Pricing lives in `src/shared.js`. Update it whenever Anthropic changes API pricing.

The defaults use public Anthropic API-equivalent model pricing in USD per million tokens. These prices are used only to estimate economic weight, not to claim actual Claude.ai subscription charges.

## How the numbers work (v0.8.0+)

**Dollars are real.** Claude bills usage credits at standard API per-token rates and exposes the month's cumulative spend (`used_credits`) through its own endpoint. The extension samples that counter (every ~60s, plus a forced re-read ~2.5s after each response finishes) and derives:

- *Session spend* = counter now − counter when the browser session started (baseline lives in `chrome.storage.session`, so it resets naturally when the browser closes; "Restart session counter" in the popup re-baselines on demand).
- *Daily spend* = counter movement per local calendar day, chained across gaps (spend that happens while the browser is closed lands on the first day it's observed again).

**Tokens are derived, and shown as a range.** tokens ≈ spend ÷ blended price, where blended $/MTok = [r·((1−c)·p_in + c·0.1·p_in) + p_out] / (r+1), with r = input:output ratio and c = cache-read fraction of input. Defaults r=6, c=0.3 (bounds 3:1/c=0 to 12:1/c=0.5 drive the displayed low–high range). Cache reads at 0.1× are Anthropic's published multiplier and are confirmed to apply to usage-credit billing. Constants live in `src/shared.js` (`SPEND_TOKEN_MIX`).

**Per-model daily breakdown (self-learning).** claude.ai's Settings → Usage page shows daily spend by model, but its endpoint is undocumented and not yet publicly known. Instead of guessing, the MAIN-world watcher notices when claude.ai itself calls a usage/spend-shaped API path, remembers that path, and the extension then reads it directly (defensively normalized, sanity-checked against the real monthly counter before it's ever displayed). Practical effect: an employee opening Claude's own usage settings page once teaches the extension the endpoint; until then the counter-sampling fallback covers everything.

## Recommended next improvements

- Add organization policy presets, for example: “warn after $3/day” or “default to Sonnet for ordinary work.”
- Add a small on-device classifier to label sessions as HR, marketing, legal, research, coding, or general admin without storing text.
- Add a “why did this cost so much?” drilldown that explains context, attachments, output length, and model choice.
- Read the actual conversation message tree (like Claude's own API returns) instead of scraping composer text, for more reliable per-conversation token totals.
- A snooze control on desktop warnings, and optional quiet hours.
- A replayable “what do these numbers mean?” first-run walkthrough.

## Changelog

### 0.9.1 (security)

- **Sandboxed file converter.** The third-party `officeparser` now runs in a manifest-declared sandbox page (opaque origin, no `chrome.*`, no network egress) instead of the privileged offscreen document — a parser exploit can no longer reach storage, the network, or Claude's session. The offscreen document relays bytes/Markdown over `postMessage` and passes the pdfjs worker in as a same-origin blob. Verified end-to-end in Chromium.
- **Signed update manifests (opt-in, ECDSA P-256).** The self-updater can now verify a signature over the update manifest before applying anything, so a compromised repo/CDN/mirror can't push code that becomes the extension. Off until a public key is set in `src/updater.js` (see "Signing updates"); until then, hash-only integrity as before. Tamper/wrong-key rejection and the sign→verify round-trip are tested in real Chromium.
- **Commit-pinned downloads.** The manifest names the immutable commit it was built from (part of the signed payload), and file downloads pin to that commit instead of the moving `main` branch.
- Custom `updateBaseUrl` is now restricted to `https`.
- New tooling: `tools/gen-signing-key.mjs`; `build-update-manifest.mjs` signs when `CUC_UPDATE_SIGNING_KEY` is present and records the source commit; the publish workflow passes the secret through.

### 0.9.1

- Fixed Caveman send interception (prompts sent untrimmed) and the unusable drop zone (click-to-pick file instead of drag, which claude.ai's overlay ate).
- **Firmer Caveman instruction** — more emphatic about persistence and leading with the answer, while still guarding substance/accuracy.
- **New setting: "Show Caveman Mode in the widget"** — hide the whole feature (row, drop zone, send-interception) from the widget if you don't want it.
- **New setting: "Show monthly usage credits"** — hide the monthly usage-credit allowance (the "$X of $Y" row in the widget and the "This month" figure in the popup) for a cleaner personal-plan view; warnings exclude it too when hidden.
- **Removed all remaining branding** — the extension, popup, Settings, and widget are now simply "Claude Companion".
- **Settings overhaul:** renamed to "Claude Companion" and removed the internal-tool framing; reorganized into five sections (Display, Alerts, Claude connection, Data & privacy, Updates) with a responsive section navigator and active-section highlighting. Dependency-free shadcn-style components (cards with bordered headers, switches, a Dollars/Tokens/Both segmented control, badges, notices, disclosures, buttons, a separated destructive action) matching the widget's visual language in both light and dark. Settings auto-save with a persistent save-status bar; the model selector dropped its pricing jargon; the account details became a connection-status panel with cache age and masked-ID controls; a privacy summary spells out what is and isn't stored.

### 0.9.0

- **Caveman Mode** (red switch at the bottom of the widget): one-time per-conversation terse-reply instruction (direct injection — Styles are deprecated and Skills trigger unreliably; see README), send-intercepting prompt trimmer with mandatory preview/approve (local, deletion-only, 28–43% measured savings on filler-heavy prompts), periodic brevity re-pin for long chats (claude.ai compacts old context), and a file→Markdown drop zone (officeparser slim in an offscreen document; DOCX/PPTX/CSV/PDF verified in real Chromium).
- New files: `src/caveman.js` (instruction + compressor + decision docs), `src/offscreen.{html,js}` (conversion service), `src/vendor/` (officeparser slim + matching pdf worker).
### 0.8.1

- Removed the hardcoded organization UUID and `$100` expected cap.
- The active organization is discovered from Claude.ai's `lastActiveOrg` cookie, with `/api/organizations` as the fallback, and cached locally for 24 hours.
- The monthly cap is accepted only from Claude's live `/usage` or `/overage_spend_limit` response and cached locally for display; there is no configured cap comparison.
- Settings now shows the detected organization and cached Claude-reported cap instead of editable organization/cap fields.

### 0.8.0

- **All dollar figures are now real.** The tokenizer and the entire text-estimation pipeline (send observers, stream text extraction, per-chat token aggregation, `o200k_base.js`) are gone. The widget's headline is now "Spent this session": Claude's own monthly usage-credit counter sampled at session start vs. now — accurate to the cent, refreshed right after each response finishes (a `generation-complete` signal forces a live counter re-read ~2.5s after every exchange).
- Daily spend history (popup trend, Today line, CSV export) is chained from real counter samples instead of estimates.
- Tokens are now **derived from real dollars** via a documented blended-price formula (r=6 input:output, 0.3 cache-read fraction; see README "How the numbers work") and displayed as an honest low–high range instead of a fake-precise count.
- Self-learning per-model breakdown: when claude.ai's own Settings → Usage page calls its (still undocumented) spend-breakdown endpoint, the extension learns the path, validates the data against the monthly counter, and uses it for the Today line and per-model token conversion.
- Popup reworked to match: session spend, real Today/This month, real 14-day trend, "Restart session counter".

### 0.7.0

- **Output tracking fixed at the root:** the network watcher is now a manifest-declared `world: "MAIN"` content script at `document_start`, so `fetch`/`XMLHttpRequest` are patched before any claude.ai code can capture the originals (the old async `<script src>` injection raced the app bundle and lost, which silently killed response/output counting). XHR-based streams are now covered too.
- Generation detection no longer depends on a hardcoded URL pattern: any claude.ai POST answered with an event-stream response counts, with a `console.debug` breadcrumb when the path doesn't match known patterns (visible drift instead of silent breakage).
- `message_limit` frames in generation streams are now parsed (sanitized utilization + reset only) and merged live into the native-limits display — fresher than the 60s poll.
- **Self-updates from GitHub:** blue in-widget banner when a newer version is on `main`; one-time "Connect extension folder" setup in Settings, then updates are one click — hash-verified downloads, nothing written unless every file verifies, automatic extension reload. CI regenerates `update/manifest.json` on every push to main.
- Widget docks below the visual chat box (not inside it) and always matches its width; follows Claude's own light/dark theme instead of the OS; condensed layout; renamed to "Claude Companion".

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
- Added an explicit organization id setting (later removed in favor of auto-detection).
- Removed daily self-limit tracking and all widget dragging/floating behavior.
- Reset local usage storage to version 2 so old overestimated chat totals do not carry forward.

### 0.4.0

**Branding:** Labeled consistently as Claude Companion — extension name, popup, options page, and widget header.

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
