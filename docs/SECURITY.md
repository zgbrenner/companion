# Security & Privacy Documentation

This document describes the security architecture, data handling, permissions, network behavior, threat model, and audit steps for **Claude Companion**, a Chromium (Chrome/Edge) browser extension (Manifest V3). It is written for IT administrators and information-security reviewers evaluating the extension for use.

- **Type:** Manifest V3 browser extension, distributed as unpacked source (or self-hosted; see [§7](#7-update-mechanism-security)).
- **Source:** all first-party code ships **unminified and human-readable**. The only compiled/minified artifacts are two vendored third-party files (see [§9](#9-third-party-dependencies)).
- **External services contacted:** Claude.ai (to read your own usage) and GitHub (to check for and download updates). **No analytics, telemetry, tracking, or third-party servers.**
- **Account impact:** strictly **read-only** against your Claude account. No request the extension issues can modify conversations, settings, billing, or organization data.

---

## Table of contents

1. [Data handling & privacy](#1-data-handling--privacy)
2. [Permissions and why each is needed](#2-permissions-and-why-each-is-needed)
3. [Network egress](#3-network-egress)
4. [Architecture & trust boundaries](#4-architecture--trust-boundaries)
5. [Content Security Policy](#5-content-security-policy)
6. [Claude session & credentials](#6-claude-session--credentials)
7. [Update mechanism security](#7-update-mechanism-security)
8. [File-conversion sandbox](#8-file-conversion-sandbox)
9. [Third-party dependencies](#9-third-party-dependencies)
10. [Prompt handling (Caveman Mode)](#10-prompt-handling-caveman-mode)
11. [Threat model summary](#11-threat-model-summary)
12. [How to audit / verify](#12-how-to-audit--verify)
13. [Incident response & key rotation](#13-incident-response--key-rotation)
14. [Known limitations & residual risks](#14-known-limitations--residual-risks)

---

## 1. Data handling & privacy

The extension's purpose is to display usage numbers that come from Claude itself. It does **not** collect, transmit, or retain the content of your work.

| Data | Read? | Stored locally? | Sent off-device? |
| --- | --- | --- | --- |
| Your prompt text | Only transiently, in-page, to offer a *local* trim preview (Caveman Mode) | **No** | **No** |
| Claude's reply text | Not read at all (only the presence of a `message_limit` frame and a "generation finished" signal are observed) | **No** | **No** |
| Uploaded file contents (Caveman file→Markdown) | Parsed locally in an isolated sandbox | **No** | **No** |
| Your Claude usage numbers (dollars, %, limits) | Yes, from Claude's own endpoint | Yes — daily spend totals and short-lived caches | **No** |
| Organization UUID | Yes, from the non-secret `lastActiveOrg` cookie / org list | Yes, cached up to 48 h | **No** (used only to address Claude's own usage endpoint) |
| Session / authentication cookie | **Never read** | **Never** | **Never** |
| Settings you choose | n/a | Yes | **No** |

**Where local data lives:**

- `chrome.storage.local` — settings, daily spend totals (dollar amounts + derived token ranges), the detected organization UUID and monthly-cap cache, notification-dedupe state, and the "update available" flag.
- `chrome.storage.session` — memory-backed, cleared when the browser closes: the current usage reading, the session-spend baseline, and pace samples.
- `IndexedDB` (`cuc-updater`) — only if you opt into one-click updates: a File System Access API *directory handle* for the extension's own folder. No file contents are stored there.

There is **no server-side component**. Nothing is uploaded. "Download CSV" (Settings → Data & privacy) writes a local file containing daily dollar totals and token ranges only — never chat text.

---

## 2. Permissions and why each is needed

From `manifest.json`:

| Permission | Purpose | Notes |
| --- | --- | --- |
| `storage` | Persist settings and spend history locally | Local only; no sync storage. |
| `activeTab` | Read the active tab's URL to find a Claude tab from the popup | No broad `tabs` permission. |
| `notifications` | Desktop alert when a Claude limit crosses 85% / 95% | Opt-out in Settings. |
| `alarms` | Schedule the periodic update check (~6 h) | MV3 timer that survives service-worker teardown. |
| `offscreen` | Host the file-conversion relay/sandbox | Only used while converting a dropped file. |

**Host permissions** (the only origins the extension may script or fetch):

| Host pattern | Purpose |
| --- | --- |
| `https://claude.ai/*`, `https://*.claude.ai/*` | Run the widget and read your usage from Claude's own endpoints. |
| `https://api.github.com/repos/zgbrenner/claudecompanion/*` | Check for updates. |
| `https://raw.githubusercontent.com/zgbrenner/claudecompanion/*` | Download update files. |

There is **no `<all_urls>`** and no wildcard host access. The extension cannot read or act on any site other than Claude.ai and the specific GitHub repository above.

---

## 3. Network egress

Every network request the extension makes, and the only hosts it can reach (enforced by host permissions **and** the Content-Security-Policy `connect-src`, [§5](#5-content-security-policy)):

| Destination | Method | Purpose | Payload sent |
| --- | --- | --- | --- |
| `claude.ai/api/organizations/{org}/usage` | GET | Read rolling limits + monthly credit spend | None (credentialed same-origin GET) |
| `claude.ai/api/organizations/{org}/overage_spend_limit` | GET | Monthly credit cap fallback | None |
| `claude.ai/api/organizations` | GET | Discover the org UUID when the cookie is absent | None |
| `raw.githubusercontent.com/.../<commit>/…` | GET | Update manifest + files | None |
| `cdn.jsdelivr.net/gh/...@<commit>/…` | GET | Update mirror (rate-limit fallback) | None |
| optional `*.pages.dev` (Cloudflare Pages) | GET | Optional self-hosted update mirror, only if configured | None |

- No request carries a body of your data. Usage reads are plain GETs; the browser attaches your existing Claude session automatically because they originate same-origin from a Claude.ai page.
- **No analytics/telemetry endpoint exists anywhere in the code.** You can confirm this by searching the source for `fetch(`/`XMLHttpRequest` — every hit targets one of the hosts above.
- The MAIN-world network observer (`injected.js`) *reads* Claude's own responses in place to detect the active model and notice when a reply finishes; it never originates a new request and never forwards response bodies or account payloads across the extension boundary.

---

## 4. Architecture & trust boundaries

The extension is split into isolated components so that the least-trusted code has the least access:

```
 ┌──────────────────────────── claude.ai tab ────────────────────────────┐
 │                                                                        │
 │  MAIN world (page):   injected.js  — patches fetch/XHR to OBSERVE       │
 │      │  sanitized events (model id, "reply finished", limit %) only     │
 │      │  guarded by a random one-time handshake token                    │
 │      ▼                                                                   │
 │  Isolated world:      content.js + shared.js + native-usage.js +        │
 │                       caveman.js  — widget UI, reads Claude usage,       │
 │                       local prompt trim. No access to page JS variables. │
 └───────────────┬────────────────────────────────────────────────────────┘
                 │ chrome.runtime messaging (sender + shape validated)
                 ▼
      background.js (service worker) — single writer of spend state,
      badge, notifications, update checks. Validates every message.
                 │ chrome.runtime messaging
                 ▼
      offscreen.html/js (extension origin) — PRIVILEGED relay for file
      conversion. Reads bytes + the pdf worker, but does NOT parse.
                 │ postMessage (bytes in / Markdown out)
                 ▼
      sandbox.html/js (OPAQUE origin, no chrome.*, no network) —
      third-party officeparser runs here, fully isolated.
```

Key boundaries:

- **MAIN world vs. isolated world.** `injected.js` runs in the page's world (so it can wrap `fetch`) but is the *least* trusted; it can only *emit* narrowly-shaped events, each stamped with a random token minted by the isolated-world script at `document_start` (before any page script runs). Events without the token are dropped, so a hostile page script cannot forge usage events.
- **Content script vs. background.** Content scripts never write the authoritative spend state directly; they send deltas to the background service worker, which is the single serialized writer. The background validates the **sender** (must be the extension's own content script on `https://claude.ai`, top frame) and the **exact shape** of every message (allow-listed keys, numeric bounds, UUID-shaped conversation ids, file-type/size caps) before acting.
- **Offscreen vs. sandbox.** The offscreen document has extension privileges but does not run the third-party parser; it relays bytes to the opaque-origin sandbox and returns Markdown. See [§8](#8-file-conversion-sandbox).

---

## 5. Content Security Policy

Two policies are declared in `manifest.json`.

**Extension pages** (popup, options, background, offscreen):

```
script-src 'self'; object-src 'none'; base-uri 'none';
connect-src 'self' https://claude.ai https://*.claude.ai https://api.github.com
            https://raw.githubusercontent.com https://cdn.jsdelivr.net https://*.pages.dev;
img-src 'self' data:; style-src 'self' 'unsafe-inline';
```

- `script-src 'self'` — no remote scripts, no `eval`, no inline script. All executable code ships in the package.
- `connect-src` — network egress is limited to exactly the hosts in [§3](#3-network-egress).
- `object-src 'none'`, `base-uri 'none'` — no plugins; no `<base>` hijacking.

**Sandbox page** (the file converter):

```
sandbox allow-scripts; script-src 'self' 'unsafe-inline' 'unsafe-eval' 'wasm-unsafe-eval' blob:;
worker-src blob:; child-src blob:; connect-src blob: data:; object-src 'none'; base-uri 'none';
```

- The `sandbox` directive gives the page an **opaque origin** with no `chrome.*` access and no extension-origin privileges.
- `connect-src blob: data:` permits only local blob/data handling — **no `http`/`https`/`ws` egress at all**, so the parser cannot exfiltrate anything. `'unsafe-eval'` is confined to this powerless origin and is required by the bundled PDF engine.

---

## 6. Claude session & credentials

- Usage requests are ordinary same-origin `GET`s issued from a Claude.ai page; the browser attaches your existing session automatically. The extension **never reads, stores, or transmits your authentication/session cookie**, and never handles your password or any token.
- The only cookie value the code reads is `lastActiveOrg` — a **non-secret organization UUID** that tells the extension which organization's usage to query. It is used solely to build the usage URL and is cached locally (≤48 h); it is never sent anywhere but Claude's own endpoint.
- All Claude requests are **read-only**. There is no `POST`/`PUT`/`DELETE` to any Claude API in the codebase; nothing can change your account, conversations, or settings.

---

## 7. Update mechanism security

The self-updater is the most security-sensitive component, because applying an update writes files into the extension and reloads it. It is defended in depth.

**Flow:** the background worker fetches `update/manifest.json` (version + per-file SHA-256 + source commit + optional signature). If a newer version exists, the widget offers to install. Installing downloads every listed file, verifies each SHA-256 **in memory before a single byte is written**, writes them (`manifest.json` last), and calls `chrome.runtime.reload()`. Writing uses the browser's File System Access API against a folder handle you granted once; the target is validated to be this extension's own folder, and file paths are restricted to `manifest.json`, `src/**`, and `icons/**` (no path traversal, no arbitrary writes).

**Integrity — SHA-256.** Each file must match the hash in the manifest, so corruption or a partial/torn deploy is rejected atomically (nothing is written on any mismatch).

**Authenticity — signature (ECDSA P-256, opt-in but strongly recommended).** Because the hashes travel in the same manifest as the files, hashes alone don't stop a *malicious* source (a compromised repo, CDN mirror, or custom base could serve bad files and matching hashes). The manifest can therefore be **cryptographically signed**, and the extension refuses any update whose signature doesn't verify against a public key compiled into `src/updater.js`. Since the manifest lists every file's hash, one signature transitively authenticates the entire update; changing any file invalidates it. The signed payload also includes the source commit ([below](#commit-pinning)).

- The **private key exists only as a GitHub Actions secret** (`CUC_UPDATE_SIGNING_KEY`); it never enters the repository. The build/publish workflow signs each release with it.
- Signing ships **dormant** (empty public key ⇒ hash-only integrity, so nothing breaks). Enabling is three steps — generate a keypair with `tools/gen-signing-key.mjs`, paste the public key into `src/updater.js`, add the private key as the Actions secret. Verification is enforced from the moment a public key is present.
- The sign→verify round-trip, tamper rejection (any modified file hash fails), and wrong-key rejection are covered by tests run in a real Chromium engine.

**Commit pinning.** The manifest is read from a moving branch (`main`) so new versions are discoverable, but it records the **immutable commit** it was built from, and every file download is pinned to that commit (`raw.githubusercontent.com/.../<commit>/…`, `jsdelivr@<commit>`). Combined with signing — the commit is part of the signed payload — code is only ever pulled from one exact commit the signature vouches for. A force-pushed or compromised branch can't swap files under a valid manifest, and there is no read-manifest-then-fetch race against the branch advancing.

**Transport.** Update fetches are HTTPS only. A custom update base URL (`updateBaseUrl`, e.g. a self-hosted Cloudflare Pages mirror) is honored **only if it is `https`**; an `http` base is ignored.

**Alternative distribution.** If you prefer not to use the self-updater at all, the extension can be distributed by any standard mechanism (Chrome Web Store private/unlisted listing, or enterprise `ExtensionInstallForcelist` with a self-hosted `.crx`), in which case the browser's own signed-update pipeline applies and the in-extension updater can be left dormant.

---

## 8. File-conversion sandbox

Caveman Mode's file→Markdown feature parses user-selected office files with a vendored third-party library (`officeparser`). Parsing untrusted file formats is a classic exploitation surface, so the parser runs with **no privileges**:

- It executes in a **manifest-declared sandbox page** (`src/sandbox.html`) — an **opaque origin** with **no `chrome.*` APIs** and, per the sandbox CSP, **no network egress** (`connect-src blob: data:` only).
- The privileged **offscreen document** never parses anything itself. It reads the file bytes and (for PDFs) the bundled worker source, hands them to the sandbox over `postMessage`, and returns the resulting Markdown. Because a sandboxed opaque origin cannot load a cross-origin worker, the PDF engine's worker is passed in and run from a **same-origin blob** inside the sandbox.
- Net effect: even a hypothetical remote-code-execution bug in the parser is confined to a powerless origin — it cannot touch extension storage, reach the network, read your Claude session, or access any `chrome.*` API. The file's bytes never leave your machine.

This isolation is verified end-to-end in a real Chromium engine (opaque origin confirmed; DOCX, CSV, and PDF all convert through the sandbox).

---

## 9. Third-party dependencies

The extension has **no runtime package dependencies** and loads **no code from any CDN at runtime**. Two third-party files are vendored (committed in-repo, served locally):

| File | What | Isolation |
| --- | --- | --- |
| `src/vendor/officeparser.browser.slim.iife.js` | Office/PDF → Markdown parser (the "slim" build: **no remote-code URLs, no OCR engine**) | Runs only in the no-privilege sandbox ([§8](#8-file-conversion-sandbox)) |
| `src/vendor/pdf.worker.min.mjs` | pdf.js worker (version-matched to the parser) | Runs as a blob worker inside the sandbox |

All other code is first-party and unminified. There is no build step that pulls dependencies at release time beyond these vendored files, reducing supply-chain surface.

---

## 10. Prompt handling (Caveman Mode)

- **Brevity instruction.** A fixed, compact instruction (in `src/caveman.js`, human-readable) is sent **as an ordinary chat message**, once per conversation. It is not hidden and uses no private API.
- **Local trimming.** Prompt trimming is 100% local, deterministic, and **extractive-only** — it deletes known filler and shortens fixed verbose phrases; it never paraphrases, and it never alters text inside code blocks, quotes, URLs, or emails. A safety valve restores the original if the rules would remove too much.
- **Preview + confirm.** Trimming never happens silently: on send you see the trimmed text (editable), the original, and the savings, and choose to send the trimmed version, edit it, or send the original. Nothing is auto-sent, and prompt text is never persisted.

---

## 11. Threat model summary

| Threat | Mitigation |
| --- | --- |
| Malicious/compromised update source (repo, jsDelivr, custom mirror) pushes code | Per-file SHA-256 + opt-in ECDSA signature the source can't forge + commit pinning + HTTPS-only |
| Man-in-the-middle on updates | HTTPS only; signature + hash verification before any write |
| Path traversal / arbitrary file write during update | File paths restricted to `manifest.json`, `src/**`, `icons/**`; folder validated as this extension's own |
| Torn/partial update leaving a broken extension | All files downloaded + hash-verified in memory before any write; `manifest.json` written last |
| Exploit in the third-party file parser | Runs in an opaque-origin sandbox: no `chrome.*`, no network, no session access |
| Hostile page script forging usage events | Random one-time handshake token; content script drops untokened events; MV3 world isolation |
| Forged/oversized messages to the background or offscreen worker | Sender identity + strict shape/size/range validation on every message |
| Exfiltration of prompts, replies, or files | None is stored or transmitted; sandbox has no network; no analytics endpoint exists |
| Session-cookie theft | Cookie never read; only the non-secret org UUID is used |
| Account modification | Read-only; no state-changing Claude request exists in the code |
| Over-broad site access | Host permissions limited to Claude.ai + one GitHub repo; no `<all_urls>` |

---

## 12. How to audit / verify

Everything needed to review the extension is in the repository and observable at runtime:

1. **Read the source.** All first-party code is unminified. Start with `manifest.json` (permissions, CSP, sandbox, content-script worlds), then `src/native-usage.js` (what Claude endpoints are read), `src/updater.js` (update verification), and `src/background.js` (message validation).
2. **Confirm the network surface.** Search the tree for `fetch(` and `XMLHttpRequest`; verify every destination is a host in [§3](#3-network-egress). Then watch **DevTools → Network** on a Claude tab and on the extension's pages during normal use and during an update — you should see only Claude usage GETs and (on update) GitHub GETs. No analytics/telemetry calls exist.
3. **Verify permissions at install.** `chrome://extensions` → Details lists the exact site access; confirm it is Claude.ai + the GitHub repo only.
4. **Confirm read-only.** Search for HTTP methods other than `GET` against `claude.ai` — there are none.
5. **Confirm no prompt/response storage.** Search for where prompt/response text is written to storage — it is not; only numeric spend totals and settings are persisted.
6. **Check the sandbox.** In DevTools, the conversion sandbox frame is an opaque origin (`null`); it has no `chrome` object and its CSP forbids network egress.
7. **Verify update authenticity (if signing is enabled).** Confirm `UPDATE_PUBLIC_KEY_SPKI_B64` in `src/updater.js` matches your published key, and that `update/manifest.json` carries a `signature` and a `commit`.

---

## 13. Incident response & key rotation

- **Rotate the signing key** (e.g., suspected private-key exposure): run `tools/gen-signing-key.mjs` to generate a new pair, update the Actions secret `CUC_UPDATE_SIGNING_KEY`, replace `UPDATE_PUBLIC_KEY_SPKI_B64` in `src/updater.js`, and publish a release. Clients on the old public key will only accept updates signed by the matching old key, so publish the key change in a release those clients can still install (i.e., ship the new public key in a build signed by the *old* key), then subsequent releases use the new key.
- **Suspend auto-updates:** remove/disable the `publish-update-manifest` workflow, or point clients away from the feed; existing installs simply stop seeing new versions (no code is pushed without a passing check).
- **Contain a bad release:** because downloads are commit-pinned and signed, reverting the repository to a known-good commit and publishing a new signed manifest is sufficient; clients will only pull the newly-signed commit.
- **Wipe a machine's local data:** Settings → Data & privacy → **Clear all local data** (clears storage, caches, and the update-folder handle). The Claude account is untouched.

---

## 14. Known limitations & residual risks

- **Undocumented Claude endpoints.** Usage is read from Claude.ai's own internal endpoints, which are not a published API and can change or disappear. If they do, the limits section shows an error and the rest of the extension keeps working; no security exposure results.
- **Unpacked/developer-mode distribution.** When loaded unpacked, the extension is only as trustworthy as the folder on disk. Restrict write access to that folder; anyone who can write to it can alter the extension. The self-updater's folder handle grants the extension write access to *its own* folder only.
- **Signing is opt-in.** Until a public key is configured, updates rely on SHA-256 integrity plus commit pinning plus HTTPS, but not signature authenticity. Enabling signing ([§7](#7-update-mechanism-security)) is strongly recommended for any multi-user deployment.
- **CDN/GitHub availability.** Update checks depend on GitHub/jsDelivr being reachable; if not, the extension keeps running on its installed version and retries later.
- **Third-party parser.** The vendored `officeparser`/pdf.js code is trusted to the extent of its sandbox — which is designed to contain it (no privileges, no network). Keep the vendored files updated from their upstream sources as part of routine maintenance.

---

*For installation and everyday use, see [QUICKSTART.md](QUICKSTART.md). For version history, see [../CHANGELOG.md](../CHANGELOG.md).*
