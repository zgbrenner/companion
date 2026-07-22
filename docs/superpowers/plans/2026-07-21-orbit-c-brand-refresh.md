# Orbit C Brand Refresh Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace COMPANION's fragmented visual identity with the approved Orbit C icon, all-caps wordmark, bundled League Spartan brand type, bundled Atkinson Hyperlegible Next UI type, and a unified graphite/mint interface.

**Architecture:** Keep provider behavior unchanged and introduce the identity through local static assets, shared font registration, semantic CSS tokens, and minimal brand markup. The manifest remains the authority for toolbar assets and provider-scoped web-accessible font resources. Existing accessibility and provider integration tests remain mandatory.

**Tech Stack:** Chrome Manifest V3, HTML, CSS, JavaScript, SVG, PNG, variable OpenType fonts, plain Node.js tests.

## Global Constraints

- Render the product name as `COMPANION` in all caps on product surfaces.
- Use League Spartan only for wordmark and brand labels.
- Use Atkinson Hyperlegible Next for UI and supporting text.
- Bundle all font files inside the extension.
- Make no Google Fonts, Adobe Fonts, CDN, analytics, or third-party font request at runtime.
- Use Orbit C with graphite `#111827`, mint `#35D6A6`, soft white `#F8FAFC`, slate `#334155`, and optional iris `#7C6CFF`.
- Preserve warning and danger semantics and WCAG AA contrast.
- Preserve all existing Claude, ChatGPT, Work, and Codex-aware behavior.

---

### Task 1: Brand Contract

**Files:**
- Create: `tests/17-brand-identity.mjs`
- Create: `docs/BRAND.md`
- Create: `docs/ATTRIBUTIONS.md`
- Create: `src/fonts/OFL.txt`

- [x] Write the failing identity contract.
- [ ] Run CI and confirm failure is caused by missing Orbit C assets and fonts.

### Task 2: Local Font System

**Files:**
- Create: `src/fonts/league-spartan-bold.woff2`
- Create: `src/fonts/atkinson-hyperlegible-next-variable.woff2`
- Modify: `src/fonts.css`
- Modify: `manifest.json`
- Modify: `src/content.js`
- Modify: `src/openai-content.js`

- [ ] Bundle both variable fonts under the SIL Open Font License.
- [ ] Register both faces from extension-local URLs.
- [ ] Expose them only to declared Claude and OpenAI origins.
- [ ] Remove Space Grotesk from runtime typography.

### Task 3: Orbit C Icon Family

**Files:**
- Create: `icons/orbit-c.svg`
- Replace: `icons/icon16.png`
- Replace: `icons/icon32.png`
- Replace: `icons/icon48.png`
- Replace: `icons/icon128.png`

- [ ] Build a source SVG with a graphite rounded tile, white open orbit, mint core, and mint endpoint.
- [ ] Render crisp size-specific PNGs.
- [ ] Confirm every PNG's intrinsic dimensions.

### Task 4: Product Wordmark and Typography

**Files:**
- Modify: `manifest.json`
- Modify: `src/popup-router.html`
- Modify: `src/popup.html`
- Modify: `src/openai-popup.html`
- Modify: `src/options.html`
- Modify: `src/popup.css`
- Modify: `src/openai-popup.css`
- Modify: `src/options.css`
- Modify: `src/widget.css`
- Modify: `src/openai-widget.css`

- [ ] Replace product-title text with `COMPANION`.
- [ ] Add the Orbit C mark to popup and settings headers.
- [ ] Apply League Spartan only to brand text.
- [ ] Apply Atkinson Hyperlegible Next to interface text.
- [ ] Unify core surfaces around graphite, soft white, slate, and mint while preserving Work and Codex context accents.

### Task 5: Validation and Merge

**Files:**
- Modify: `CHANGELOG.md`

- [ ] Run the complete test suite.
- [ ] Confirm zero serious or critical accessibility violations.
- [ ] Inspect the retained CI transcript.
- [ ] Update the pull request with exact validation evidence.
- [ ] Merge only after the final head passes.
