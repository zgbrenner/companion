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

**Produces:** A failing contract that defines the exact release documents, claims, workflow, and image dimensions required by later tasks.

- [x] Write `tests/20-release-readiness.mjs` with checks for finalized v1.2 metadata, multi-provider store disclosures, release automation, launch documents, and exact image dimensions.
- [ ] Open a draft pull request and run the suite to verify the contract fails because the release materials do not exist or still describe the Claude-only v1.0 product.

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

- [ ] Rewrite the listing for COMPANION, both providers, the `native numbers or nothing` principle, and a summary of 132 characters or fewer.
- [ ] Rewrite the privacy policy to cover Claude and OpenAI page-world normalization, all stored keys by category, exact hosts, deletion, and no developer collection.
- [ ] Add justifications for `alarms` and both provider host groups; correct `activeTab`, `notifications`, `offscreen`, and remote-code explanations.
- [ ] Update the submission checklist for v1.2.0, current image requirements, two-step verification, deferred publishing, current permissions, trusted-test sequence, and support/review setup.
- [ ] Add reviewer test instructions and an architecture note that explains how to exercise Claude and ChatGPT behavior without inventing account data.
- [ ] Finalize the changelog and write release notes for users.

### Task 3: Release automation

**Files:**
- Modify: `tools/package-webstore.sh`
- Create: `.github/workflows/release-package.yml`
- Modify: `.gitignore`

**Produces:** A reproducible ZIP and SHA-256 checksum retained as CI artifacts.

- [ ] Harden the packaging script to reject tests, docs, source maps, development fonts, environment files, temporary editor files, and undeclared top-level package entries.
- [ ] Make package order and timestamps deterministic where the available ZIP tooling permits it.
- [ ] Add a manually dispatchable and tag-triggered workflow that runs every numbered test, builds the ZIP, lists and audits its contents, creates a checksum, and uploads both files.
- [ ] Ignore generated release output locally.

### Task 4: Visual launch assets

**Files:**
- Replace: `store/promo-tile-440x280.png`
- Create: `store/marquee-1400x560.png`
- Replace/Create: `store/screenshots/01-overview.png`
- Replace/Create: `store/screenshots/02-claude-usage.png`
- Replace/Create: `store/screenshots/03-chatgpt-work-codex.png`
- Replace/Create: `store/screenshots/04-settings-privacy.png`
- Replace/Create: `store/screenshots/05-local-efficiency-tools.png`
- Create: `docs/launch/assets/product-hunt-thumbnail-240x240.png`
- Create: `docs/launch/assets/product-hunt-gallery-01-1270x760.png`
- Create: `docs/launch/assets/product-hunt-gallery-02-1270x760.png`
- Create: `docs/launch/assets/product-hunt-gallery-03-1270x760.png`
- Create: `docs/launch/assets/social-card-1200x630.png`

**Produces:** A consistent Orbit C visual package for CWS, Product Hunt, social previews, and launch posts.

- [ ] Compose all assets from the approved Orbit C mark and real popup/settings renders.
- [ ] Keep promotional tiles brand-led and low-text.
- [ ] Keep screenshots full-bleed, legible when downscaled, and honest about provider data availability.
- [ ] Validate PNG magic bytes and intrinsic dimensions through `tests/20-release-readiness.mjs`.

### Task 5: README and public launch kit

**Files:**
- Modify: `README.md`
- Create: `docs/launch/LAUNCH_PLAYBOOK.md`
- Create: `docs/launch/LAUNCH_COPY.md`
- Create: `docs/launch/PRESS_KIT.md`
- Create: `docs/launch/PRIVACY_SAFE_GROWTH_METRICS.md`

**Produces:** Publish-ready positioning and channel-specific launch material without spam or telemetry.

- [ ] Rewrite the README hero around COMPANION, the Orbit C visual system, the core problem, and current screenshots.
- [ ] Provide clear install paths for Chrome Web Store after approval and unpacked development testing before approval.
- [ ] Add a concise feature comparison, privacy proof, provider boundaries, support links, and ethical calls to star, review, or share after experiencing value.
- [ ] Create a launch playbook covering preflight, deferred publishing, trusted testing, launch day, the first week, support response, and review collection.
- [ ] Create tailored Product Hunt, Hacker News, Reddit, X, LinkedIn, and group-chat copy with no coordinated-vote language.
- [ ] Create a press kit with one-line, short, medium, and long descriptions; factual key points; maker quote; FAQ; and asset map.
- [ ] Define privacy-safe acquisition, activation, retention, reputation, and support metrics sourced from CWS, GitHub, and launch platforms only.

### Task 6: Verification and handoff

**Files:**
- Modify: pull request body only after evidence is available.

**Produces:** A mergeable release-prep pull request with current evidence.

- [ ] Run the full numbered test suite on the final head.
- [ ] Run the release-package workflow and inspect the package file list and checksum artifact.
- [ ] Inspect all CWS and launch images at their native sizes.
- [ ] Confirm the privacy policy, listing, manifest, permission justifications, and reviewer notes do not contradict one another.
- [ ] Update the pull request with exact workflow IDs, test count, artifact names, and the manual actions that remain.
- [ ] Mark ready and merge only if the final head is green and mergeable.
