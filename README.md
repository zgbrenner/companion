# Claude Companion

A privacy-first Chrome/Edge browser extension that shows you your **real** Claude.ai usage — in dollars, tokens, or both — pinned right under the chat box while you work, alongside Claude's own session/weekly/monthly limits.

![Claude Companion widget docked under the Claude.ai chat box](docs/images/widget.png)

Every dollar figure is read straight from Claude's own usage-credit counter — accurate to the cent, never estimated. Tokens are the only derived numbers, shown as an honest range rather than false precision. Nothing you type or receive is ever stored or sent anywhere but Claude's own servers.

---

## Documentation

| Doc | For |
| --- | --- |
| **[Quick Start](docs/QUICKSTART.md)** | Installing, first-run setup, and day-to-day use. |
| **[Security & Privacy](docs/SECURITY.md)** | Detailed architecture, data handling, permissions, threat model, and audit steps for IT / infosec. |
| **[Changelog](CHANGELOG.md)** | Version history. |

---

## What it does

Display usage as:

- **Dollars** — real usage-credit spend, read from Claude's own counter, accurate to the cent.
- **Tokens** — an approximate range derived from those real dollars using current Anthropic pricing.
- **Both** — dollars and the token range together.

The widget shows:

- **Spent this session** — how much your usage-credit counter moved since you opened your browser (all your Claude activity in that window, any tab or device).
- **Today** — real daily spend.
- **Claude's real limits** — the 5-hour session limit, the weekly limit, the weekly Opus limit, and the monthly usage-credit allowance, each with a reset countdown, pulled directly from Claude's own usage endpoint.
- **Caveman Mode** (optional) — a quota-stretching toggle: ultra-brief replies, local prompt trimming with a preview, and file → Markdown conversion. See below.

### Toolbar popup and Settings

<p>
  <img src="docs/images/popup.png" alt="Toolbar popup showing session spend, today/this-month, a 14-day spend trend, and Claude's limits" width="330" />
</p>

The Settings page is organized into Display, Alerts, Claude connection, Data & privacy, and Updates, with a live connection-status panel and per-feature switches:

![Claude Companion settings page](docs/images/settings.png)

---

## How the numbers work

**Dollars are real.** Claude bills usage credits at standard API per-token rates and exposes the month's cumulative spend through its own endpoint. The extension samples that counter (every ~60 s, plus a forced re-read a couple of seconds after each response finishes) and derives:

- *Session spend* = counter now − counter when the browser session started.
- *Daily spend* = the counter's movement per local calendar day.

**Tokens are derived, and shown as a range.** `tokens ≈ spend ÷ blended price`, where the blended price mixes input/output and prompt-cache rates. Because the real input:output split and cache-hit rate are genuinely uncertain, the token figure is displayed as a low–high range (e.g. "≈2.1–4.7M tokens"), never a fake-precise single number.

## Native limits (ground truth, not an estimate)

Alongside the derived token range, the widget and popup show Claude's own rolling limits — the 5-hour session limit that locks people out mid-workday, the weekly limit, the weekly Opus limit, and the monthly usage-credit allowance — pulled from the same internal endpoint Claude's own settings page uses. This is exact, not approximated. A plain-English warning appears at 80%+ utilization, and the toolbar icon shows a badge so you're warned even with the widget hidden.

The monthly usage-credit view can be turned off in Settings for a cleaner personal-plan view.

## Caveman Mode

An optional toggle for when quota is running low and every token counts:

1. **Claude replies ultra-brief.** A compact instruction is sent once per conversation asking for the fewest words that fully answer — filler-free, but never at the expense of substance or accuracy.
2. **Your prompts get trimmed — with your approval, always.** On send, a preview shows a locally-trimmed version of your prompt (deletion-only; it never paraphrases or touches code, quotes, or URLs). Send the trimmed version, edit it, or send the original. Nothing is ever auto-sent.
3. **Files convert to Markdown.** Pick a PDF/DOCX/PPTX/XLSX/CSV/HTML file and it's converted to lean Markdown locally, then dropped into the chat box — Claude ingests Markdown more efficiently than a raw binary. Conversion runs in an isolated sandbox (see [Security](docs/SECURITY.md)).

## Privacy in one paragraph

Everything stays on your device. **Stored locally:** your settings and daily spend totals (dollar amounts and derived token ranges). **Never stored:** the text of your prompts or Claude's replies, file contents, or your login. The extension talks only to Claude's own servers (to read your usage) and to GitHub (to check for updates) — there is no analytics, no telemetry, and no third-party server. It is strictly read-only against your Claude account. Full detail in **[docs/SECURITY.md](docs/SECURITY.md)**.

## Install

See the **[Quick Start](docs/QUICKSTART.md)**. In short: enable Developer mode at `chrome://extensions`, "Load unpacked", select this folder, and open `https://claude.ai`.

## Updates

Updates install straight from GitHub — no Chrome Web Store, no uninstall/reinstall, settings kept. The extension checks for a newer version, shows an "Update ready" banner, and (after a one-time folder-connect) installs it in one click. Every downloaded file is SHA-256-verified before anything is written, downloads are pinned to an immutable commit, and the update manifest can be cryptographically signed so a compromised repo or CDN can't push code. Setup and the security model are in [Quick Start](docs/QUICKSTART.md) and [Security](docs/SECURITY.md).

## Files

```text
manifest.json                    Extension manifest (permissions, CSP, sandbox declaration)
icons/                           Toolbar/notification icons
src/content.js                   In-page widget: rendering, docking, Caveman Mode DOM logic
src/content.css                  Host-level docking styles
src/widget.css                   Widget styles (injected into the widget's shadow root)
src/injected.js                  MAIN-world network observer (model detection, message_limit frames)
src/native-usage.js              Reads Claude's own usage endpoints
src/caveman.js                   Caveman instruction + local, extractive-only prompt trimmer
src/background.js                 Service worker: spend baselines, badge, notifications, update checks
src/offscreen.html / .js         Privileged relay that hosts the conversion sandbox
src/sandbox.html / .js           Isolated (opaque-origin) file → Markdown converter
src/vendor/                      Vendored officeparser slim bundle + matching pdf worker
src/updater.js                   GitHub-pull self-updater (hash + signature verified)
src/popup.* / options.*          Toolbar popup and Settings page
src/shared.js                    Shared defaults, pricing, and spend/token math
tools/build-update-manifest.mjs  Generates + signs update/manifest.json
tools/gen-signing-key.mjs        One-time signing keypair generator
update/manifest.json             Signed update feed the extension polls (regenerated by CI)
docs/                            Quick Start, Security, and screenshots
```

## Design principles

1. **Real over estimated.** Dollar figures come from Claude's own counter; only tokens are derived, and always shown as a range.
2. **Local and private.** No prompt/response text is stored; nothing is sent anywhere but Claude and (for updates) GitHub.
3. **Read-only.** No request the extension makes can modify your account, conversations, or settings.
4. **Human-facing units first.** Budgets and plain-English limits, not token jargon.
