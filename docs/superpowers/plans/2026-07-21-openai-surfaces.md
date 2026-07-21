# OpenAI Surfaces Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend Companion to ChatGPT Chat, ChatGPT Work, and Codex-aware web surfaces without changing the shipped Claude adapter.

**Architecture:** Keep provider-specific network and DOM integrations isolated behind `src/platform.js`. Compose the two privileged routers through a tiny service-worker entry point, and route the toolbar popup by active provider.

**Tech Stack:** Chrome Manifest V3, plain JavaScript, Shadow DOM, Playwright, axe-core, existing sandboxed offscreen converter.

## Global Constraints

- Claude behavior and selectors remain unchanged.
- No telemetry or external service is introduced.
- Raw OpenAI account payloads, prompts, replies, and files never cross the page event bridge.
- Render only native numeric usage that was actually observed.
- Host permissions remain limited to Claude and ChatGPT HTTPS origins.
- Standalone Codex desktop injection is outside the Chrome extension boundary.

---

### Task 1: Platform core

**Files:**
- Create: `src/platform.js`
- Create: `tests/06-platforms.mjs`

**Interfaces:**
- Produces: `globalThis.CompanionPlatform.detectProvider(url)`
- Produces: `globalThis.CompanionPlatform.detectSurface({ url, selectedModeText })`
- Produces: `globalThis.CompanionPlatform.conversationIdFromUrl(url)`
- Produces: `globalThis.CompanionPlatform.normalizeOpenAIUsage(payload, options)`

- [x] Write a failing contract test for exact origins, Chat/Work/Codex detection, conversation IDs, numeric normalization, and unrelated-payload rejection.
- [x] Verify the test fails because `src/platform.js` is absent.
- [x] Implement the bounded defensive platform core.
- [x] Run the contract test and verify it passes.
- [x] Commit the test and implementation separately.

### Task 2: Manifest and privileged router

**Files:**
- Create: `tests/07-openai-manifest.mjs`
- Create: `src/service-worker.js`
- Create: `src/openai-background.js`
- Modify: `manifest.json`

**Interfaces:**
- Consumes: normalized OpenAI snapshots from `openai-content.js`
- Produces: provider-scoped storage, badge, notifications, Caveman claims, and conversion responses

- [ ] Write a failing manifest test that asserts version 1.2.0, exact OpenAI hosts, separated Claude and OpenAI scripts, MAIN-world injection, and popup routing.
- [ ] Run it and verify the current Claude-only manifest fails.
- [ ] Add the composite service worker and strict OpenAI sender/message validators.
- [ ] Update the manifest without altering the existing Claude script arrays.
- [ ] Run the manifest test and existing boot test.
- [ ] Commit.

### Task 3: OpenAI network adapter

**Files:**
- Create: `src/openai-injected.js`
- Create: `tests/08-openai-network.mjs`

**Interfaces:**
- Produces authenticated `cuc:openai-network-event` and `cuc:openai-usage-snapshot` DOM events containing sanitized data only

- [ ] Write tests for exact-origin filtering, random-token handshake, numeric-only snapshots, and generation completion.
- [ ] Verify failures against the missing file.
- [ ] Implement first-party fetch and XHR observation with bounded JSON parsing and SSE usage scanning.
- [ ] Verify tests pass and no prompt or response body is emitted.
- [ ] Commit.

### Task 4: OpenAI widget and composer integration

**Files:**
- Create: `src/openai-content.js`
- Create: `src/openai-widget.css`
- Create: `tests/09-openai-widget.mjs`

**Interfaces:**
- Consumes: `CompanionPlatform`, `ClaudeUsageCompanion`, `ClaudeUsageCompanionCaveman`
- Produces: `#cuc-openai-widget` shadow host and provider-scoped background messages

- [ ] Write a Playwright harness for ChatGPT composer mounting, Chat/Work/Codex changes, dark mode, and safe send interception.
- [ ] Verify failure because no widget mounts.
- [ ] Implement bounded composer discovery, docking, width tracking, SPA remounting, and theme sync.
- [ ] Add truthful usage states and the surface-aware visual system.
- [ ] Port Caveman preview and local file conversion using OpenAI-scoped messages.
- [ ] Run widget, converter, and accessibility tests.
- [ ] Commit.

### Task 5: Provider-aware popup

**Files:**
- Create: `src/popup-router.html`
- Create: `src/popup-router.js`
- Create: `src/openai-popup.html`
- Create: `src/openai-popup.css`
- Create: `src/openai-popup.js`
- Create: `tests/10-popup-routing.mjs`

**Interfaces:**
- Consumes: active tab URL and `cuc:openai-usage`
- Produces: redirect to legacy Claude popup or a native OpenAI popup

- [ ] Write failing popup routing and rendering tests.
- [ ] Implement active-origin routing with a safe Claude fallback.
- [ ] Render the last trustworthy OpenAI snapshot with exact counters and an unavailable state.
- [ ] Run boot, popup, and accessibility tests.
- [ ] Commit.

### Task 6: Documentation and release validation

**Files:**
- Create: `docs/OPENAI_SUPPORT.md`
- Modify: `README.md`
- Modify: `CHANGELOG.md`
- Modify: `tests/README.md`

**Interfaces:**
- Produces: accurate installation, privacy, supported-surface, and Codex-boundary documentation

- [ ] Update product copy from Claude-only to multi-provider without weakening the real-dollar explanation for Claude.
- [ ] Document what OpenAI data is native versus unavailable.
- [ ] State the standalone Codex desktop boundary explicitly.
- [ ] Run `node tests/run.mjs` in CI and inspect all workflow jobs.
- [ ] Fix any failures, request a final diff review, and open a draft pull request.
