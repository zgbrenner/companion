# Changelog

All notable changes to COMPANION are recorded here. The most recent release is at the top.

### 1.4.1 (Release automation + store readiness)

- Added a continuous release pipeline: a version bump pushed to the main branch now builds, tests, attests, creates the GitHub release, and uploads and publishes the package to the Chrome Web Store through a `workflow_call`-based auto-release workflow.
- Regenerated the promotional tile, marquee, and all five store screenshots as current-brand artwork built from real product renders.
- Unified store screenshot naming under one numbered scheme, replacing the earlier widget-light and popup-light filenames.
- Repaired the release-asset guard in CI so a missing generated launch asset fails the release workflow instead of being silently skipped.
- Updated the store listing and submission documents with the public website links at https://companion.pages.dev.
- Removed a leftover temporary source-export workflow from CI. No extension behavior, permission, or storage changes shipped in this release.

### 1.4.0 (Lifejacket + ChatGPT release)

- Merged the complete Lifejacket local prompt, reply, and file workflow with first-class ChatGPT Chat and Work support.
- Repaired MobileBERT Q8 quantization with selective sensitive-layer preservation; the release model now passes fidelity, latency, and size gates.
- Fixed the settings wrapper, aligned browser coverage with the shipped shadow-DOM selectors, and exercised compression through the local offscreen route.
- Added model metadata hashes, bounded HTTPS-only build-time downloads, exclusive temporary files, bounded compression concurrency, and safer release workflow permissions.
- Added deterministic release provenance, package/review assets, and current v1.4.0 documentation.

### 1.3.0 (ChatGPT first-class hardening)

- Made ChatGPT Chat and Work web support a first-class path while retaining narrow compatibility detection for legacy Codex web routes. The standalone Codex desktop app remains outside Chrome extension injection.
- Normalized the native OpenAI rate-limit response shape, including numeric Unix-second and Unix-millisecond reset timestamps, primary and secondary windows, exact token counters, and native credit balances.
- Rendered native credit balances separately from usage so a balance is never mistaken for consumption or a quota estimate.
- Unified freshness handling across the in-page widget and popup so expired readings never flash as current values, and the popup preserves the active Chat or Work surface during routing.
- Hardened the OpenAI page observer with bounded response reads and bounded numeric values, expanded resilient composer selectors, and rotated new-chat fallback state correctly.
- Kept the shared toolbar badge monotonic for same-provider readings and removed the redundant OpenAI badge writer so badge ownership remains serialized in one place.
- Added focused regression coverage for native balances, Unix reset timestamps, popup surface routing, stale badge ordering, and ChatGPT browser rendering.

### 1.2.0 (multi-provider + Orbit C)

- Introduced the Orbit C identity, all-caps COMPANION wordmark, and locally bundled League Spartan and Atkinson Hyperlegible Next typography across the toolbar, popups, settings, and provider widgets.
- Added automatic support for Claude, ChatGPT Chat, ChatGPT Work, and Codex-aware ChatGPT web surfaces.
- Added a ChatGPT-native widget, provider-aware toolbar popup, Caveman Mode, local prompt trimming, and sandboxed file-to-Markdown conversion on supported ChatGPT composers.
- Added native OpenAI usage rendering for bounded numeric usage, limit, quota, credit, reset, and token fields that OpenAI exposes to the page. Unsupported data is omitted rather than estimated.
- Replaced the fixed-name OpenAI DOM bridge with random per-page event channels established through a one-time `document_start` mailbox that the MAIN-world observer removes immediately.
- Kept raw OpenAI account responses in the page world. Only bounded normalized numeric usage data crosses into the extension.
- Removed URL query strings from retained OpenAI source metadata so access values, identifiers, and conversation parameters cannot be stored or displayed.
- Narrowed usage-endpoint matching and hardened XHR handling for JSON response types and unreadable response bodies.
- Removed the broad `tabs` permission. Provider-aware popup routing now relies on `activeTab` and exact host permissions.
- Made the OpenAI observer self-contained so it no longer depends on helper state crossing JavaScript worlds.
- Added shared OpenAI freshness states across the in-page widget and toolbar popup: fresh under five minutes, aging through fifteen minutes, visibly stale through two hours, and hidden after expiry.
- Made missing or implausibly future observation timestamps fail closed instead of presenting untrustworthy values.
- Added serialized provider ownership for the shared toolbar badge. Old OpenAI cleanup can no longer erase a newer Claude badge or a newer OpenAI reading.
- Reintroduced the narrow `alarms` permission solely to remove a high OpenAI warning badge after its native reading becomes two hours old, even when no ChatGPT tab remains open. Alarm names contain only provider and observation time.
- Added startup reconciliation for badge ownership: orphaned or expired badges are cleared, valid Claude ownership is preserved, and a missing future OpenAI expiry alarm is recreated.
- Enforced `badge-state.js` as the only service-worker component allowed to reach Chrome's native badge API.
- Added a Chromium privacy regression test proving that Clear all local data removes Claude and OpenAI local state, session state, caches, and the toolbar badge.
- Pinned Playwright and axe-core to verified versions and cached the matching Chromium build to prevent unrelated upstream changes from silently changing CI behavior.
- Expanded the numbered suite to cover native OpenAI rendering, profile-field exclusion, query-string stripping, event-forgery resistance, bridge startup timing, stale warnings, expired-value hiding, data reset, badge ownership, restart reconciliation, single-writer enforcement, brand rendering, local font integrity, and reproducible CI.
- Rewrote the OpenAI and security documentation to match the multi-provider architecture, freshness policy, badge expiry, and Codex desktop boundary.

### 1.1.0 (insights)

Built from an open-source research pass covering ccusage, Claude-Code-Usage-Monitor, claudetuner, par-cc-usage, and public Claude usage extensions. COMPANION adopted ideas that fit its local privacy model and rejected cloud sync, cross-user scoring, and tokenizer-based pre-send estimates.

- Added **This week** spend in the widget and popup, aligned to Claude's current weekly reset window when available.
- Added burn rate and month projection under the popup trend.
- Added local-only plan-fit insights after enough history exists, including weekly peak patterns and days near the limit.
- Made every trend bar keyboard-focusable with an accessible date and real-spend tooltip.
- Added daily, weekly, and monthly CSV export granularity.
- Added an opt-in always-on toolbar badge that stays neutral below 80% and switches to warning colors above it.
- Added the committed browser test suite and CI for extension boot, settings migration, popup rendering, file conversion, and accessibility.

### 1.0.0 (Chrome Web Store foundation)

- Corrected per-model spend normalization so cents-versus-dollars is decided once per response using field names before magnitude.
- Made monthly-counter sanity checks retry the alternative unit before rejecting a payload.
- Prevented small server-side utilization jitter from clearing pace projections.
- Made draft restoration wait for the composer to clear and refuse to overwrite new user input.
- Scoped Caveman send interception and draft reading strictly to the chat composer.
- Applied the same 800,000-character output cap to text and Markdown files as every other converted format.
- Preserved cent precision for realistic dollar values.
- Prevented a hidden monthly allowance from influencing the session-spend bar.
- Fixed repeat desktop notifications so a persistent hot limit can warn again only after the configured interval.
- Removed raw NUL bytes from `caveman.js` so source-control tools treat it as text.
- Tightened the sandbox Content Security Policy and made the packaging script reject common development artifacts.
- Improved trend-chart accessibility and added MIT licensing and contribution documentation.
- Removed the built-in self-update mechanism. Store updates now ship through the Chrome Web Store.
- Added store submission documents and `tools/package-webstore.sh`.
