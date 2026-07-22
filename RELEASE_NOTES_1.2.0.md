# COMPANION v1.2.0

## One private efficiency layer for Claude and ChatGPT

COMPANION v1.2.0 expands from a Claude usage companion into one local extension for Claude, ChatGPT Chat, ChatGPT Work, and Codex-aware ChatGPT web surfaces.

It keeps the same core rule:

> **Native numbers or nothing.**

COMPANION displays provider-reported numeric usage when a provider exposes it. When a trustworthy value is unavailable, it shows an honest empty state instead of guessing.

## Highlights

### Claude and ChatGPT in one extension

- Automatic provider and surface detection
- Claude-native usage, spend, limit, reset, history, and plan-fit views
- ChatGPT-native widget and toolbar popup
- Work and Codex-aware visual context without a manual mode switch
- Shared settings and local tools across supported composers

### Local efficiency tools

- Caveman Mode for concise replies that preserve important facts and caveats
- Conservative local prompt-trimming preview with explicit user approval
- Local file-to-Markdown conversion for PDF, DOCX, PPTX, XLSX, CSV, HTML, text, and OpenDocument formats
- Optional toolbar warnings and desktop notifications at trustworthy native thresholds

### Privacy and security hardening

- No COMPANION account, server, analytics, telemetry, advertising, or tracking
- Raw OpenAI account responses remain in the page world
- Only bounded normalized numeric fields cross the OpenAI bridge
- Query strings are removed from stored source metadata
- Random per-page event channels and defense-in-depth schema validation
- Exact Claude and ChatGPT HTTPS host access only
- Local opaque-origin file parser with no network or extension API access
- Serialized badge ownership so provider updates cannot erase one another
- Stale OpenAI warning badges expire after two hours
- Clear all local data removes Claude and OpenAI state, caches, and badge ownership

### Orbit C identity

- New Orbit C icon family
- All-caps COMPANION wordmark
- League Spartan for brand text
- Atkinson Hyperlegible Next for interface text
- Graphite, soft-white, slate, mint, and restrained provider-context accents
- Local WOFF2 fonts with no runtime font service

## Provider boundaries

### Claude

Claude spend and native-limit values come from Claude's own signed-in account endpoints. Token ranges are derived only from native spend and are labeled as ranges.

### ChatGPT, Work, and Codex-aware web surfaces

OpenAI account capabilities vary. COMPANION renders supported numeric usage, quota, credit, limit, reset, or token fields only when OpenAI exposes them to the page. An empty state is expected on accounts or surfaces that expose no supported value.

The standalone native Codex desktop application does not host Chrome extensions. COMPANION supports Codex-aware web routes and shared agentic usage exposed through ChatGPT web.

## Installation

The Chrome Web Store link will be added after approval. Until then, maintainers and trusted testers can load the extracted release package through `chrome://extensions` using Developer mode.

Use the package produced by `.github/workflows/release-package.yml` or run:

```bash
tools/package-webstore.sh
```

## Verification

The release candidate is covered by the full numbered Chromium suite, including:

- extension boot and settings persistence
- Claude and OpenAI popup rendering
- sandboxed file conversion
- accessibility audits
- provider and surface detection
- OpenAI bridge privacy filtering
- native usage and freshness behavior
- complete local-data reset
- cross-provider badge ownership and restart recovery
- Orbit C branding and local font integrity
- reproducible package and release-readiness checks

## Upgrade notes

No migration action is required. Existing settings and Claude history remain local. New OpenAI snapshots and operational state use separate storage keys and can be removed with **Clear all local data**.

## Independent project

COMPANION is not affiliated with, endorsed by, sponsored by, or produced by Anthropic or OpenAI. Claude, ChatGPT, Work, and Codex are trademarks of their respective owners.
