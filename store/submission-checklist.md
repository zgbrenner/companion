# Chrome Web Store Submission Checklist — Companion v1.0.0

Step-by-step for taking this extension from repo to a published CWS listing.

---

## 1. One-time developer account setup

- [ ] Register a Chrome Web Store developer account at the [Developer Dashboard](https://chrome.google.com/webstore/devconsole) if not already done.
- [ ] Pay the **one-time $5 USD registration fee** (per Google account, not per extension — skip if this account has already paid it for a prior extension).
- [ ] Verify the account email if prompted.

## 2. Build the upload package

- [ ] Confirm `manifest.json` reflects the store build: `"version": "1.0.0"`, self-updater code and its permissions/host entries removed (no `alarms` permission, no `api.github.com` / `raw.githubusercontent.com` / `*.pages.dev` host permissions or CSP `connect-src` entries — `connect-src` should be limited to `'self' https://claude.ai https://*.claude.ai`).
- [ ] Run the packaging script:
  ```
  tools/package-webstore.sh
  ```
  This produces `dist/companion-1.0.0.zip`, containing exactly `manifest.json`, `src/`, and `icons/` at the zip root. The script refuses to package a manifest that still references the removed self-update subsystem.
- [ ] Sanity-check the zip: unzip it to a scratch folder and `chrome://extensions` → Load unpacked from there, confirm it loads with no console errors and no references to the removed update mechanism.

## 3. Screenshots

- [ ] Prepare **1 to 5** screenshots (1 minimum, 5 maximum — the store requires at least one).
- [ ] Format: **PNG**, dimensions **1280×800** (preferred) or **640×400** — pick one size and use it consistently across all screenshots.
- [ ] Suggested shots, in priority order:
  1. The widget docked under the claude.ai chat box, showing real spend.
  2. The toolbar popup (session spend, today, this month, 14-day trend, limits).
  3. The limits view with reset countdowns.
  4. Caveman Mode toggle / prompt-trim preview.
  5. Settings page.
- [ ] Source images exist at `docs/images/*.png` (widget, popup, settings) — re-export/crop these to the exact store dimensions rather than reusing the README's arbitrary-width versions.
- [ ] Upload the five 1280×800 PNGs already in `store/screenshots/` (widget, popup, and settings in light theme; widget and popup in dark theme).

## 4. Promotional tile (optional but recommended)

- [ ] Small promo tile: **440×280 PNG**. Optional, but listings with a promo tile get better placement in category browsing/search — recommended for launch.
- [ ] Marquee (1400×560) and large tile (920×680) are only needed if requesting featured placement — skip for initial submission.

## 5. Store listing fields

- [ ] Paste content from `store/listing.md`: extension name, short description (116/132 chars — verify it still fits if edited), detailed description, category (**Productivity**, see `listing.md` for reasoning), language (**English**).
- [ ] Upload icon: use `icons/icon128.png` (already in repo) as the store icon.

## 6. Privacy tab

- [ ] **Privacy policy URL** — host `store/privacy-policy.md` on GitHub and link the rendered or raw URL, e.g.:
  ```
  https://github.com/zgbrenner/claudecompanion/blob/main/store/privacy-policy.md
  ```
  (Use the `blob` URL for a readable rendered page, or `raw.githubusercontent.com/...` if the field requires a raw text/HTML response rather than a GitHub UI page — check CWS's current validation behavior at submission time and use whichever it accepts.)
- [ ] Paste content from `store/permission-justifications.md` into: single purpose description, and each permission's justification field (storage, activeTab, notifications, offscreen, host permission justification).
- [ ] "Are you using remote code?" → **No**, with the explanation from `permission-justifications.md` (two bundled libraries ship locally in the package; nothing is fetched at runtime).
- [ ] Data usage disclosure checklist → check **only** "Website content"; leave all other categories unchecked; tick the three required certification statements. See `store/permission-justifications.md` for full reasoning.

## 7. Trademark / naming risk

- [x] **Resolved proactively:** the extension's original name paired "Claude" with "Companion"; it was renamed to just **"Companion"** before submission specifically to avoid using Anthropic's "Claude" mark in the product name, heading off a CWS **impersonation / trademark policy** flag rather than waiting for one.
- [ ] **Residual risk is low but not zero:** the listing copy (short/detailed description, privacy policy) still references "Claude.ai" descriptively, since the extension needs to be findable and its purpose needs to be clear. This is standard nominative fair use — identifying the compatible product, not branding the extension with the mark — but reviewers doing a fast pass could still flag it.
- [ ] **Mitigations in place:**
  - Explicit non-affiliation disclaimer at the end of the detailed description ("Companion is an independent, unofficial project... not affiliated with, endorsed by, or sponsored by Anthropic. 'Claude' is a trademark of Anthropic, PBC.") — still required and unchanged by the rename.
  - Same disclaimer duplicated in the privacy policy header.
  - No use of Anthropic/Claude logos or brand assets — icon is original.
- [ ] If review still flags the listing, trim "Claude.ai" mentions to the minimum needed for clarity (e.g. keep it in the short description and the non-affiliation line, drop repeated uses elsewhere) rather than renaming again.

## 8. Trader / non-trader declaration (EU DSA)

- [ ] The Digital Services Act requires every developer publishing to EU users to declare **trader** or **non-trader** status in the dashboard's "Account" settings before submission.
- [ ] For an individual developer (zgbrenner) publishing a free extension with no commercial trading entity, **non-trader** is almost always the correct declaration — confirm against current criteria in the dashboard, as Google's definitions can change. Complete this once per developer account; it blocks publishing to the EU if left unset.

## 9. Submit and review

- [ ] Submit for review.
- [ ] **Expected review time:** typically a few hours to a few business days for a new listing; can extend to ~1–2 weeks if the automated/manual review flags something (permissions, host access, or the trademark issue in §7) and requires a manual look or a resubmission cycle. Budget for at least one round of back-and-forth on a first submission.
- [ ] Watch the developer dashboard and the registered account email for review correspondence — CWS communicates rejections and requested changes there, not elsewhere.

## 10. Post-approval

- [ ] **Updates now ship through the Chrome Web Store**, not the extension's old self-updater — that mechanism has been removed from the store build. Do not re-add GitHub host permissions or the `alarms` permission in future store releases.
- [ ] For every future release: bump `"version"` in `manifest.json` (CWS requires a strictly increasing version to accept an update), rebuild with `tools/package-webstore.sh`, and upload the new zip as a new package version in the dashboard. Each update goes through review again, generally faster than the initial listing review.
- [ ] Keep `store/privacy-policy.md`'s "Last updated" date current any time data handling changes, since the CWS listing links directly to it.
- [ ] If distributing outside the store is still desired for some users (e.g., enterprise `ExtensionInstallForcelist`), that is a separate, unpacked/self-hosted distribution path and does not affect the CWS listing.
