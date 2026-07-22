# COMPANION for OpenAI Surfaces

## Goal

Extend COMPANION from Claude.ai to ChatGPT Chat, ChatGPT Work, and Codex-aware OpenAI surfaces while preserving the existing Claude implementation and privacy model.

## Product behavior

COMPANION auto-detects the active provider and surface. On Claude.ai it behaves exactly as it does today. On ChatGPT it detects Chat, Work, or Codex from the route and selected mode, docks beneath the active composer, follows the page theme, and applies a visual treatment that feels native to that surface.

The shared features remain available wherever there is a writable chat composer:

- Caveman Mode
- local prompt trimming with a preview before send
- local file-to-Markdown conversion
- theme-aware docked widget
- limit alerts and toolbar badge when trustworthy utilization data is exposed
- local-only storage and no telemetry

## Honest usage model

Provider usage is an adapter boundary.

Claude continues using its existing native usage adapter without modification. OpenAI uses a separate adapter that observes only first-party ChatGPT network responses and extracts sanitized numeric usage, credit, token, reset, and utilization fields. It never forwards raw account payloads, prompt text, response text, or file contents across the page boundary.

OpenAI exposes different usage fields across plans and surfaces. COMPANION therefore renders only values it actually observes. It never estimates a dollar amount or invents a quota. Missing values are presented as unavailable on the current surface.

Work and Codex can share an agentic usage pool. COMPANION labels that pool `Agentic usage` instead of pretending it is isolated to one product.

## Architecture

### Shared platform core

`src/platform.js` owns exact-origin provider detection, Chat/Work/Codex surface detection, conversation ID extraction, and defensive normalization of OpenAI numeric usage payloads.

### Claude adapter

The existing Claude files remain intact:

- `src/content.js`
- `src/injected.js`
- `src/native-usage.js`
- `src/background.js`

This minimizes regression risk in the shipped Claude experience.

### OpenAI adapter

- `src/openai-injected.js`: MAIN-world first-party network observer with a token-authenticated event bridge
- `src/openai-content.js`: isolated-world widget, composer integration, Caveman Mode, and local file conversion
- `src/openai-background.js`: trusted-sender validation, OpenAI state, notifications, badge, and conversion routing
- `src/openai-widget.css`: surface-aware Chat, Work, and Codex visual system

`src/service-worker.js` imports the existing Claude background and the OpenAI background so both providers coexist without merging two security-sensitive routers into one large file.

### Popup routing

`src/popup-router.html` and `src/popup-router.js` inspect the active tab. Claude opens the existing popup. ChatGPT opens `src/openai-popup.html`, which displays the most recent trustworthy OpenAI usage snapshot and detected surface.

## Surface detection

Detection uses several signals in descending confidence:

1. exact origin
2. URL route and query state
3. selected mode controls with `aria-selected`, `aria-pressed`, or current-state attributes
4. narrow header and toolbar text only

The detector never scans conversation text for `Work` or `Codex`, avoiding false positives from messages.

## Composer integration

The OpenAI adapter prefers stable IDs and test IDs such as `#prompt-textarea`, then falls back to a bounded search for an editable within a small composer-like form that contains a send button. It rejects unrelated editables and never intercepts rename, search, settings, or instructions fields.

The widget is inserted after the visible rounded composer shell, uses a shadow root, and tracks its width with `ResizeObserver`. It remounts safely during single-page navigation.

## Theme and aesthetics

The shared layout is restrained and native:

- Chat: neutral graphite surfaces with a restrained green accent
- Work: neutral surfaces with a subtle violet accent
- Codex: graphite surfaces, indigo accent, and selective monospace details

The widget follows the page's rendered light or dark mode, honors reduced motion, and maintains WCAG AA contrast and visible keyboard focus.

## Security and privacy

- host permissions are limited to Claude and ChatGPT origins
- sender validation requires the extension ID, top frame, trusted HTTPS origin, and exact message shape
- page-world events require a random handshake token established at `document_start`
- raw network payloads never cross the page event bridge
- only bounded numeric usage snapshots and short metadata are retained
- prompts, replies, and uploaded file contents are never stored or transmitted
- file conversion remains inside the existing sandboxed offscreen pipeline

## Codex boundary

The Chrome extension supports Codex when Codex is presented as a ChatGPT web route or composer surface. The standalone Codex desktop shell is not a normal Chrome extension host, so COMPANION cannot inject into that native shell through Manifest V3. On ChatGPT web, COMPANION can still display any shared Work/Codex agentic usage data that OpenAI exposes.

## Testing

The test suite covers:

- provider and surface detection
- OpenAI usage normalization
- exact host permissions and content-script separation
- service worker composition
- ChatGPT composer mounting, theme synchronization, surface switching, and Caveman interception
- popup routing
- zero serious or critical accessibility violations on the OpenAI popup and widget harness

## Release

Version `1.2.0` introduces multi-provider support. Documentation and store copy describe COMPANION as an unofficial local usage and efficiency companion for Claude and ChatGPT, with the Codex desktop limitation stated explicitly.
