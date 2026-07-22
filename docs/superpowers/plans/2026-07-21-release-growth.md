# COMPANION v1.2 Release and Growth Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produce a tested Chrome Web Store release candidate, accurate public documentation, coordinated launch assets, and an organic growth playbook for COMPANION v1.2.0.

**Architecture:** Treat release engineering, store compliance, visual assets, and distribution copy as separate workstreams joined by one release-readiness contract. Keep all runtime privacy guarantees unchanged. Build and validate the actual extension package in CI, while keeping launch actions such as publishing and changing repository visibility manual.

**Tech Stack:** Chrome Manifest V3, Bash, GitHub Actions, Node.js tests, Markdown, PNG assets, Python/Pillow for reproducible launch artwork.

## Global Constraints

- Product name is `COMPANION` in all caps.
- Release version is `1.2.0`.
- No analytics, telemetry, tracking pixel, remote font, or third-party runtime service may be added.
- Listing and privacy language must accurately describe Claude, ChatGPT Chat, ChatGPT Work, and Codex-aware web support.
- OpenAI usage is shown only when OpenAI exposes a supported native numeric field.
- Prompts, replies, and files are not stored or transmitted by COMPANION.
- Promotional material must not claim awards, rankings, affiliations, or usage numbers that do not exist.
- Product Hunt copy must request feedback, not upvotes.
- Publishing, repository visibility changes, account creation, and sending launch posts remain manual launch actions.

---

### Task 1: Release-readiness contract

**Files:**
- Create: `tests/20-release-readiness.mjs`
- Create: `docs/superpowers/specs/2026-07-21-release-growth-design.md`
- Create: `docs/superpowers/plans/2026-07-21-release-growth.md`

**Produces:** A contract that defines the exact release documents, claims, workflow, generated images, and dimensions required by later tasks.

- [x] Write `tests/20-release-readiness.mjs` with checks for finalized v1.2 metadata, multi-provider store disclosures, release automation, launch documents, and exact image specifications.
- [x] Open draft PR #24 and verify the initial contract failed for the expected missing and stale release materials while the preceding 19 product tests remained green.

### Task 2: Store compliance and reviewer package

**Files:**
- Modify: `store/listing.md`
- Modify: `store/privacy-policy.md`
- Modify: `store/permission-justifications.md`
- Modify: `store/submission-checklist.md`
- Create: `store/test-instructions.md`
- Create: `store/reviewer-notes.md`
- Modify: `CHANGELOG.md`
- Create: `RELEASE_NOTES_1.2.0.md`

**Produces:** Copy that can be pasted into the Chrome Web Store dashboard and a self-contained reviewer guide.

- [x] Rewrite the listing for COMPANION, both providers, the `native numbers or nothing` principle, and a 120-character summary within the 132-character limit.
- [x] Rewrite the privacy policy to cover Claude and OpenAI page-world normalization, locally stored categories, exact hosts, deletion, transient prompt and file handling, and no developer collection.
- [x] Add justifications for `alarms` and both provider host groups; correct `activeTab`, `notifications`, `offscreen`, remote-code, and user-data disclosures.
- [x] Update the submission checklist for v1.2.0, current image requirements, two-step verification, deferred publishing, current permissions, trusted-test sequence, and support/review setup.
- [x] Add reviewer test instructions and architecture notes that explain how to exercise Claude and ChatGPT behavior without inventing account data.
- [x] Finalize the changelog and write user-facing v1.2.0 release notes.

### Task 3: Release automation

**Files:**
- Modify: `tools/package-webstore.sh`
- Create: `.github/workflows/release-package.yml`
- Modify: `.gitignore`

**Produces:** A reproducible ZIP, checksum, package inventory, test transcript, and launch-artwork bundle retained as CI artifacts.

- [x] Harden the packaging script to reject tests, docs, source maps, development fonts, environment files, temporary editor files, remote-code patterns, symlinks, and undeclared package roots.
- [x] Make package order and timestamps deterministic.
- [x] Add a manually dispatchable, tag-triggered, and pull-request release workflow that renders the current UI, generates launch artwork, runs the numbered suite, builds and audits the ZIP, creates a checksum, and uploads both release bundles.
- [x] Ignore generated release and test output locally.
- [x] Validate the packaging script offline with shell syntax checking, two byte-identical repeated builds, archive inspection, and a negative remote-code test.
- [x] Parse the final workflow as valid YAML and verify all required steps and artifacts are declared.

### Task 4: Visual launch assets

**Files:**
- Create: `tools/generate-launch-assets.py`
- Generate in release workflow: `store/promo-tile-440x280.png`
- Generate in release workflow: `store/marquee-1400x560.png`
- Generate in release workflow: five `store/screenshots/*.png` images at 1280×800
- Generate in release workflow: Product Hunt thumbnail and three gallery images
- Generate in release workflow: social card at 1200×630

**Produces:** A consistent Orbit C visual package generated from real popup and Settings renders for each release commit.

- [x] Compose all assets from the approved Orbit C mark and real Chromium popup and Settings renders.
- [x] Keep promotional tiles brand-led and low-text.
- [x] Keep screenshots full-bleed, legible when downscaled, and honest about provider data availability.
- [x] Validate PNG magic bytes and exact intrinsic dimensions through the generator and `tests/20-release-readiness.mjs` when `REQUIRE_GENERATED_ASSETS=1`.
- [x] Inspect a local contact sheet and each generated asset at native size.

### Task 5: README and public launch kit

**Files:**
- Modify: `README.md`
- Create: `docs/launch/LAUNCH_PLAYBOOK.md`
- Create: `docs/launch/LAUNCH_COPY.md`
- Create: `docs/launch/PRESS_KIT.md`
- Create: `docs/launch/PRIVACY_SAFE_GROWTH_METRICS.md`
- Create: privacy-safe GitHub issue and security-reporting templates

**Produces:** Publish-ready positioning and channel-specific launch material without spam or telemetry.

- [x] Rewrite the README hero around COMPANION, the Orbit C visual system, the core problem, and committed product renders.
- [x] Provide clear install paths for Chrome Web Store after approval and unpacked release-candidate testing before approval.
- [x] Add a concise feature comparison, privacy proof, provider boundaries, support links, and ethical calls to star, review, or share only after experiencing value.
- [x] Create a launch playbook covering preflight, deferred publishing, trusted testing, launch day, the first week, support response, and review collection.
- [x] Create tailored Product Hunt, Hacker News, Reddit, X, LinkedIn, group-chat, outreach, support, and honest-review copy with no coordinated-vote language.
- [x] Create a press kit with one-line, short, medium, and long descriptions; factual key points; maker quote; FAQ; and asset map.
- [x] Define privacy-safe acquisition, activation, retention, reputation, support, and experiment metrics sourced from distribution platforms and voluntary feedback only.
- [x] Add structured GitHub bug, feature, and private security-reporting intake that warns users not to disclose credentials or private content.

### Task 6: Verification and handoff

**Produces:** A merged release-preparation change set, with actual publication gated on a fresh release-workflow run and real-account smoke test.

- [x] Confirm the PR changes no runtime extension files; the previously green 19-test product build remains the runtime baseline.
- [x] Syntax-check the new release contract.
- [x] Validate the deterministic package builder offline, including repeatability and negative security behavior.
- [x] Validate the release workflow structure as YAML.
- [x] Run and visually inspect the launch generator locally using real Chromium-rendered COMPANION surfaces.
- [x] Confirm the privacy policy, listing, manifest, permission justifications, reviewer notes, and launch copy use the same provider and data-handling boundaries.
- [x] Identify and document the external CI blocker: the `zgbrenner` account has used 2,000 of 2,000 included Actions minutes and jobs are rejected before checkout until paid usage is enabled or the allowance resets on August 1, 2026.
- [ ] Before Chrome Web Store submission, run `.github/workflows/release-package.yml` after Actions capacity is restored, download both artifacts, verify the SHA-256 checksum, and smoke-test the exact extracted ZIP on real Claude and ChatGPT accounts.
- [ ] Complete the manual publication actions in `store/submission-checklist.md` and `docs/launch/LAUNCH_PLAYBOOK.md`.
