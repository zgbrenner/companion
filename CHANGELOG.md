# Changelog

All notable changes to Companion. The most recent release is at the top.

### Unreleased (OpenAI hardening)

- Introduced the Orbit C identity, all-caps COMPANION wordmark, and locally bundled League Spartan and Atkinson Hyperlegible Next typography across the toolbar, popups, settings, and provider widgets.
- Replaced the fixed-name OpenAI DOM bridge with random per-page event channels established through a one-time `document_start` mailbox that the MAIN-world observer removes immediately.
- Raw OpenAI account responses remain in the page world. Only bounded normalized numeric usage data crosses into the extension.
- Removed URL query strings from retained OpenAI source metadata so access values, identifiers, and conversation parameters cannot be stored or displayed.
- Narrowed usage-endpoint matching and hardened XHR handling for JSON response types and unreadable response bodies.
- Removed the broad `tabs` permission. Provider-aware popup routing now relies on `activeTab` and exact host permissions.
- Made the OpenAI observer self-contained so it no longer depends on helper state crossing JavaScript worlds.
- Added shared OpenAI freshness states across the in-page widget and toolbar popup: fresh under five minutes, aging through fifteen minutes, visibly stale through two hours, and hidden after expiry.
- Missing or implausibly future observation timestamps now fail closed instead of presenting untrustworthy values.
- Freshness labels update automatically while the page or popup remains open.
- Added serialized provider ownership for the shared toolbar badge. Old OpenAI cleanup can no longer erase a newer Claude badge or a newer OpenAI reading.
- Reintroduced the narrow `alarms` permission solely to remove a high OpenAI warning badge after its native reading becomes two hours old, even when no ChatGPT tab remains open. Alarm names contain only provider and observation time.
- Badge ownership now reconciles when the service worker starts: orphaned or expired badges are cleared, valid Claude ownership is preserved, and a missing future OpenAI expiry alarm is recreated.
- Enforced `badge-state.js` as the only service-worker component allowed to reach Chrome's native badge API. Legacy direct writes from provider adapters are blocked before they can bypass ownership or expiry rules.
- Added a Chromium privacy regression test proving that Clear all local data removes Claude and OpenAI local state, session state, caches, and the toolbar badge.
- Pinned Playwright and axe-core to verified versions and cached the matching Chromium build, preventing unrelated upstream releases from changing CI behavior without a repository update.
- Added end-to-end coverage for native OpenAI usage rendering, profile-field exclusion, query-string stripping, event-forgery resistance, bridge startup timing, stale warnings, expired-value hiding, data reset, badge ownership, restart reconciliation, single-writer enforcement, and reproducible CI policy.
- Rewrote the OpenAI and security documentation to match the multi-provider architecture, freshness policy, badge expiry, and Codex desktop boundary.

### 1.1.0 (insights)

Built from a broad open-source research pass (ccusage, Claude-Code-Usage-Monitor, claudetuner, par-cc-usage, and a survey of every claude.ai usage extension on GitHub) — adopting the ideas that fit Companion's privacy model and rejecting the ones that don't (cloud sync, cross-user scoring, tokenizer-based pre-send estimates).

- **"This week" spend** in the widget and popup — week-to-date real dollars aligned to Claude's actual weekly reset window (the one rollup that matches how the weekly limit works), individually toggleable like every other metric.
- **Burn rate & month projection** under the popup trend: "Averaging $X/day — on pace for ~$Y this month."
- **Plan fit insights.** Companion now keeps a local-only history of each day's peak limit utilization and, after two weeks of data, gives a plain-English read on whether your plan matches your usage (P90 weekly peaks, days at 95%+). Nothing leaves your device; the history is wiped by "Clear all local data."
- **Accessible trend chart** — each of the 14 day-bars is now a focusable button with a visible tooltip (date + real spend) on hover and keyboard focus.
- **CSV export granularity** — daily, weekly, or monthly rows.
- **Opt-in always-on badge** — keep the toolbar badge visible even when nothing is running hot (gray until 80%, then the existing amber/red).
- **Committed test suite + CI** (`tests/`, plain node scripts, no framework): extension boot, settings persistence and legacy migration, popup rendering, the full file-conversion pipeline, and an axe-core accessibility audit — run on every push and PR via GitHub Actions.

### 1.0.0 (Chrome Web Store)

- **Pre-submission audit fixes (round 2):**
  - The per-model spend breakdown's cents-vs-dollars unit is now decided once per response using the field name first (`credit` → cents, `usd` → dollars) instead of a per-row magnitude guess that could read a genuine `spend_usd: 1000` as $10 — or even split one response across two units. The monthly-counter sanity check now retries the other unit before rejecting.
  - Pace projections no longer lose their history to sub-2% downward jitter in Claude's utilization numbers (only a genuine window reset clears them).
  - Restoring an unsent draft after the Caveman instruction goes out now waits for the composer to actually clear instead of a fixed 900ms timer, and never overwrites text the user typed in the meantime.
  - The Caveman switch and session-spend meter expose their tooltip explanations to screen readers (`aria-describedby` / visually-hidden text) instead of mouse-only `title` attributes.
- **Pre-submission audit fixes:**
  - Caveman's send interceptor and draft reading are now scoped strictly to the chat composer — pressing Enter in another editable on claude.ai (a rename field, project instructions) can no longer open the trim preview with that field's text or send it as a chat message.
  - The file-converter's `.txt`/`.md` fast path now applies the same 800k-character output cap as every other format (a 20 MB text file no longer lands whole in the composer) and shows conversion progress.
  - Dollar figures keep cent precision at all realistic magnitudes ($15.67 no longer displays as $16).
  - Hiding "Monthly allowance" now also stops the session-spend bar from filling (and announcing) as a percentage of that hidden monthly cap.
  - The "at most one repeat nudge per 6 hours" desktop-notification rule actually works (it was unreachable dead code — a limit that stayed hot could never re-notify within a reset window).
  - `caveman.js` no longer contains raw NUL bytes (the compressor's protected-region placeholders are now written as escaped `\u0000` literals), so git/grep treat it as reviewable text instead of a binary file — same runtime behavior.
  - Tightened the sandbox CSP (dropped an unused `'unsafe-inline'` for scripts) and the packaging script now refuses to ship dev artifacts (`*.map`, `.env*`, tests).
  - The popup's 14-day trend is readable by assistive tech (per-day figures in the chart's accessible label, not just hover tooltips).
  - Added `LICENSE` (MIT) and `CONTRIBUTING.md`; fixed stale docs (version badge, removed-feature references, duplicate SECURITY.md section numbers).
- **Chrome Web Store release preparation:** removed the built-in self-update mechanism (updates now ship through the Chrome Web Store), dropped the then-unneeded `alarms` permission and GitHub/CDN host permissions and CSP entries — the extension connected only to claude.ai at that release.
- Added store submission documents under `store/` and a packaging script `tools/package-webstore.sh`.
