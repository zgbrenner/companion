# ChatGPT, Work, and Codex Support

Companion 1.2 adds a separate OpenAI adapter alongside the existing Claude adapter. It automatically detects the active provider and surface, then presents the same core efficiency tools in a visual style that fits the page.

## Supported surfaces

| Surface | In-page widget | Caveman Mode | File to Markdown | Native usage data |
| --- | ---: | ---: | ---: | ---: |
| ChatGPT Chat on the web | Yes | Yes | Yes | When OpenAI exposes it |
| ChatGPT Work on the web | Yes | Yes | Yes | Agentic pool when exposed |
| Codex-aware ChatGPT web route | Yes | Yes | Yes | Shared agentic pool when exposed |
| Standalone Codex desktop shell | No browser injection | Not through this extension | Not through this extension | May still appear on ChatGPT web if shared data is exposed |
| Claude.ai | Existing full support | Yes | Yes | Existing Claude limits and spend |

## Automatic detection

Companion uses exact origins, the current route, selected mode controls, and narrow header state. It does not scan conversation messages for the words Chat, Work, or Codex.

The OpenAI widget uses three related visual treatments:

- Chat uses neutral graphite surfaces and a restrained green accent.
- Work uses neutral surfaces and a subtle violet accent.
- Codex uses graphite surfaces, indigo accents, and selective monospace details.

All three follow the page's light or dark theme and honor reduced-motion preferences.

## What usage data means

Claude and OpenAI expose different account data. Companion keeps their adapters separate.

On Claude, the dollar counter remains the source of truth, exactly as before.

On OpenAI surfaces, Companion watches only first-party responses that look like usage, limits, credits, billing, agentic, or Codex state. It extracts supported numeric fields inside the page and sends only the normalized numbers to the extension. Depending on the account and surface, this can include:

- agentic credits used and available
- rolling session, daily, weekly, or monthly utilization
- reset timestamps
- exact token counters returned by OpenAI

Companion does not invent a limit, estimate a dollar figure, or scrape messages when a counter is unavailable. The widget says that it is waiting for native usage data instead.

Work and Codex may draw from the same agentic usage pool. Companion labels that counter `Agentic usage` so it does not imply that the pool belongs exclusively to one surface.

## Privacy design

The OpenAI adapter follows the same local-only design as the Claude adapter:

- Only ChatGPT HTTPS origins are permitted.
- The privileged background accepts messages only from the extension's own top-frame content script on an exact trusted origin.
- The page-world observer and isolated content script establish a random token handshake at document start.
- Raw account JSON never crosses the page event bridge.
- Prompts and replies are never stored or transmitted by Companion.
- File conversion stays in the existing sandboxed offscreen pipeline.
- No analytics, telemetry, or third-party service is added.

## Why standalone Codex desktop is different

A Manifest V3 Chrome extension can inject into supported browser pages. It cannot inject its content script into a native desktop application shell that is not hosting an extension-enabled web page.

Companion therefore supports Codex-aware web surfaces and shared agentic usage that OpenAI exposes on ChatGPT web. It does not claim to modify the standalone Codex desktop interface.

## Troubleshooting

If the widget does not appear:

1. Confirm the extension has access to `chatgpt.com`.
2. Reload the ChatGPT tab after updating the unpacked extension.
3. Open a normal Chat, Work, or Codex-aware web composer.
4. Check Companion Settings and confirm the widget is enabled.

If Caveman Mode opens a preview but the message does not send, review the preview and use the ChatGPT send button once. Companion deliberately never sends hidden text without a visible user action.

If usage rows are empty, the current OpenAI response may not expose supported counters for that account or surface. Caveman Mode and file conversion still work normally.
