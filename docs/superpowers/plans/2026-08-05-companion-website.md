# COMPANION Website Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build and verify a clean, static COMPANION product website that deploys directly to Cloudflare Pages.

**Architecture:** Source files live under `website/`. A dependency-free Node build script copies canonical extension assets and produces `dist-site/`, including legal pages, Cloudflare configuration, canonical metadata, and a generated sitemap. The website does not alter or bundle the extension runtime.

**Tech Stack:** Semantic HTML5, modern CSS, vanilla JavaScript, Node.js 22 file-system APIs, Cloudflare Pages static hosting.

## Global Constraints

- Keep the approved Orbit C brand and palette.
- Use only repository-local fonts and images.
- Do not add analytics, telemetry, advertising, cookies, APIs, or remote code.
- Do not estimate unsupported provider usage values.
- Keep Chrome Web Store launch behavior configurable through one environment variable.
- Keep `dist-site/` generated and untracked.

---

### Task 1: Static build contract

**Files:**
- Create: `tools/build-site.mjs`
- Create: `tests/31-website-build.mjs`
- Modify: `package.json`
- Modify: `.gitignore`

**Interfaces:**
- Consumes: `website/`, `icons/`, `src/fonts/`, and `store/screenshots/`.
- Produces: `buildSite({ rootDir, outDir, siteUrl, storeUrl })` and the `dist-site/` directory.

- [x] **Step 1: Write the failing build test**

Test that stale output is removed, source and canonical assets are copied, site URL tokens are replaced, a sitemap is generated, missing required assets fail the build, and the optional Chrome Web Store URL controls all store links.

- [x] **Step 2: Run the test and confirm it fails because `tools/build-site.mjs` does not exist**

```bash
node tests/31-website-build.mjs
```

- [x] **Step 3: Implement the dependency-free build script**

Export `buildSite()` and make direct execution build from the repository root. Validate HTTP or HTTPS URLs, require every referenced canonical asset, and return `{ outDir, siteUrl, storeUrl, filesWritten }`.

- [x] **Step 4: Run the build test**

```bash
node tests/31-website-build.mjs
```

Expected: `site build contract: pass`.

### Task 2: Homepage and product interactions

**Files:**
- Create: `website/index.html`
- Create: `website/assets/site.css`
- Create: `website/assets/site.js`
- Create: `tests/32-website-content.mjs`

**Interfaces:**
- Consumes: `/assets/orbit-c.svg`, local fonts, and copied screenshots.
- Produces: responsive homepage, mobile navigation, and keyboard-operable screenshot tabs.

- [x] **Step 1: Write the failing content test**

Assert required product positioning, screenshots, launch language, privacy claims, legal links, local assets, and absence of remote analytics or font endpoints.

- [x] **Step 2: Run the test and confirm missing website files fail it**

```bash
node tests/32-website-content.mjs
```

- [x] **Step 3: Implement the homepage and shared design system**

Create the product-led hero, accuracy band, extension tour, features, Lifejacket workflow, privacy architecture, open-source section, FAQ, final call to action, responsive layout, reduced-motion support, and interaction script.

- [x] **Step 4: Run the content test**

```bash
node tests/32-website-content.mjs
```

Expected: `site content contract: pass`.

### Task 3: Legal, security, support, and Cloudflare output

**Files:**
- Create: `website/privacy/index.html`
- Create: `website/terms/index.html`
- Create: `website/security/index.html`
- Create: `website/support/index.html`
- Create: `website/accessibility/index.html`
- Create: `website/404.html`
- Create: `website/_headers`
- Create: `website/_redirects`
- Create: `website/robots.txt`
- Create: `website/manifest.webmanifest`
- Create: `website/README.md`

**Interfaces:**
- Consumes: the shared stylesheet, script, and Orbit C asset.
- Produces: public policy/support routes and a hardened Cloudflare Pages package.

- [x] **Step 1: Add complete policy and support content**

Cover local storage, temporary processing, provider boundaries, Cloudflare hosting logs, no sale or advertising, local deletion, lossy compression, parser limits, third-party independence, security reporting, installation, troubleshooting, and accessibility feedback.

- [x] **Step 2: Add static-hosting controls**

Use a restrictive CSP, no-referrer policy, denied framing, no unnecessary browser permissions, canonical redirects, robots metadata, sitemap generation, and local manifest icons.

- [x] **Step 3: Build and scan generated output**

```bash
SITE_URL=https://companion.example npm run build:site
grep -R '{{SITE_URL}}\|{{STORE_URL}}' dist-site && exit 1 || true
```

Expected: build succeeds and no unresolved token is found.

### Task 4: Browser and release verification

**Files:**
- Verify: `dist-site/`
- Create: `docs/superpowers/specs/2026-08-05-companion-website-design.md`
- Create: `docs/superpowers/plans/2026-08-05-companion-website.md`

**Interfaces:**
- Consumes: completed generated site.
- Produces: reviewable screenshots and a verified pull request.

- [x] **Step 1: Verify desktop behavior at 1440×1000**

Confirm the hero, calls to action, product frames, product tabs, section rhythm, focus behavior, and lack of horizontal overflow.

- [x] **Step 2: Verify mobile behavior at 390×844**

Confirm headline wrapping, mobile navigation, call-to-action sizing, no horizontal overflow, and no page errors.

- [x] **Step 3: Run all website checks**

```bash
npm run test:site
npm run build:site
```

Expected: both website tests pass and `dist-site/` builds successfully.

- [x] **Step 4: Commit to an isolated branch and open a pull request**

Use branch `feature/companion-website` and summarize Cloudflare deployment settings and verification results in the pull request body.
