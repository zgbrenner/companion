# COMPANION Website Design

## Purpose

Create a polished public website for COMPANION that is deployable on Cloudflare Pages, accurately reflects extension v1.4.0, reuses the approved Orbit C brand system and real extension screenshots, and clearly communicates the product's local and open-source architecture.

## Product positioning

The site leads with three promises:

1. know provider-reported usage before a limit interrupts work;
2. reduce avoidable prompt, reply, and file overhead with Lifejacket Mode;
3. keep COMPANION processing local and inspectable.

The core accuracy statement is: **Native numbers or nothing.** The site must distinguish provider-native values from derived ranges and must not imply that unsupported ChatGPT or Claude quotas are estimated.

## Visual system

- Graphite `#111827` for primary dark surfaces and text.
- Soft white `#F8FAFC` and white for content surfaces.
- Mint `#35D6A6` as the primary action and active-state accent.
- Iris `#7C6CFF` as a restrained secondary accent.
- League Spartan for the all-caps COMPANION wordmark.
- Atkinson Hyperlegible Next for headings, body copy, controls, and legal content.
- Existing Orbit C assets and extension screenshots are copied into the site build rather than duplicated in source.
- Layout uses open sections, thin dividers, and a small number of purposeful framed product views. It avoids generic AI artwork, provider-logo clusters, decorative stock imagery, and repetitive card grids.

## Information architecture

### Homepage

1. Header with Features, Privacy, Open source, GitHub, and Chrome Web Store launch state.
2. Product-led hero using real extension screenshots.
3. Accuracy principle band.
4. Interactive extension tour for widget, popup, settings, and dark mode.
5. Feature explanations for native usage, alerts, and controls.
6. Lifejacket workflow and its three independent tools.
7. Privacy architecture and simplified data flow.
8. Open-source and independent-project statement.
9. FAQ.
10. Chrome Web Store launch call to action.

### Supporting pages

- `/privacy/`: website and extension privacy policy.
- `/terms/`: limitations, third-party services, warranty, and governing law.
- `/security/`: permissions, provider boundaries, Lifejacket, sandboxing, and disclosure process.
- `/support/`: installation and troubleshooting.
- `/accessibility/`: WCAG 2.2 AA target and feedback route.
- `/404.html`: branded not-found page.

## Architecture

The website is static HTML, CSS, and minimal JavaScript under `website/`. `tools/build-site.mjs` creates `dist-site/` by:

- deleting stale output;
- copying website source;
- copying required brand assets, fonts, screenshots, and store artwork from their canonical repository locations;
- replacing the canonical site URL;
- resolving the Chrome Web Store link from one optional environment variable;
- generating `sitemap.xml`.

No frontend framework, runtime dependency, remote font, analytics script, cookie banner, API, or server-side function is required.

## Chrome Web Store launch state

The source contains `{{STORE_URL}}` links. At build time:

- without `CHROME_WEB_STORE_URL`, links remain visibly marked as coming soon and are made non-navigating with `aria-disabled`;
- with `CHROME_WEB_STORE_URL`, every store call to action becomes live from the same environment variable.

## Cloudflare Pages

- Build command: `npm run build:site`
- Output directory: `dist-site`
- Node version: 22 or newer
- Required environment variable for a custom domain: `SITE_URL`
- Optional launch environment variable: `CHROME_WEB_STORE_URL`

The output includes `_headers`, `_redirects`, `robots.txt`, a web app manifest, canonical metadata, a sitemap, local fonts, and restrictive Content Security Policy headers.

## Accessibility and responsive behavior

- Semantic landmarks and one page-level heading.
- Skip links and visible focus indicators.
- Keyboard-operable product tabs and mobile navigation.
- Useful screenshot alt text and captions.
- Reduced-motion support.
- No horizontal page overflow at 390 px or 1440 px test widths.
- Target WCAG 2.2 AA.

## Verification

Automated tests cover build output, stale-file removal, required-asset failures, URL replacement, centralized store-link behavior, required copy and legal pages, absence of analytics and remote fonts, and external-link safety attributes. Browser QA covers desktop and mobile overflow, tab behavior, mobile navigation, page errors, and rendered screenshots.
