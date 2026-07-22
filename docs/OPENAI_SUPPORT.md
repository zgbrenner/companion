# ChatGPT, Work, and Codex Support

COMPANION 1.2 adds a separate OpenAI adapter alongside the existing Claude adapter. It automatically detects the active provider and surface, then presents the same core efficiency tools in a visual style that fits the page.

## Supported surfaces

| Surface | In-page widget | Caveman Mode | File to Markdown | Native usage data |
| --- | ---: | ---: | ---: | ---: |
| ChatGPT Chat on the web | Yes | Yes | Yes | When OpenAI exposes it |
| ChatGPT Work on the web | Yes | Yes | Yes | Agentic pool when exposed |
| Codex-aware ChatGPT web route | Yes | Yes | Yes | Shared agentic pool when exposed |
| Standalone Codex desktop shell | No browser injection | Not through this extension | Not through this extension | May still appear on ChatGPT web if shared data is exposed |
| Claude.ai | Existing full support | Yes | Yes | Existing Claude limits and spend |

## Automatic detection

COMPANION uses exact origins, the current route, selected mode controls, and narrow header state. It does not scan conversation messages for the words Chat, Work, or Codex.

The OpenAI widget uses three related visual treatments:

- Chat uses neutral graphite surfaces and a restrained green accent.
- Work uses neutral surfaces and a subtle violet accent.
- Codex uses graphite surfaces, indigo accents, and selective monospace details.

All three follow the page's light or dark theme and honor reduced-motion preferences.

## What usage data means

Claude and OpenAI expose different account data. COMPANION keeps their adapters separate.

On Claude, the dollar counter remains the source of truth, exactly as before.

On OpenAI surfaces, COMPANION passively inspects only first-party responses whose path suggests usage, limits, quota, credits, billing, subscription, rate limits, or agentic usage. It extracts supported numeric fields inside the page and forwards only the normalized numbers to the extension. Depending on the account and surface, this can include:

- agentic credits used and available
- rolling session, daily, weekly, or monthly utilization
- reset timestamps
- exact token counters returned by OpenAI

COMPANION does not invent a limit, estimate a dollar figure, or scrape messages when a counter is unavailable. The widget says that it is waiting for native usage data instead.

Work and Codex may draw from the same agentic usage pool. COMPANION labels that counter `Agentic usage` so it does not imply that the pool belongs exclusively to one surface.

## Freshness and stale readings

Each OpenAI snapshot carries the time it was observed. The in-page widget and toolbar popup use the same freshness policy:

- **Fresh:** less than five minutes old.
- **Aging:** five to fifteen minutes old. Values remain visible with their exact age.
- **Stale:** fifteen minutes to two hours old. Values remain visible, but COMPANION clearly warns that they may be out of date.
- **Expired:** more than two hours old. COMPANION hides the old numbers instead of presenting them as current.
- **Missing or implausible timestamp:** values fail closed and remain hidden.

Freshness labels update automatically while the page or popup remains open. Using ChatGPT, Work, or a Codex-aware web surface allows COMPANION to observe a new native reading when OpenAI returns one.

## Privacy and bridge design

The OpenAI adapter follows the same local-only design as the Claude adapter:

- Only exact ChatGPT HTTPS origins are permitted.
- The privileged background accepts messages only from the extension's own top-frame content script on an exact trusted origin.
- At `document_start`, the isolated extension script creates a random channel name in a temporary DOM mailbox.
- The MAIN-world observer reads and removes that mailbox immediately, before host-page scripts run.
- Later usage and generation events use the unguessable channel names and JSON-string payloads.
- Raw account responses never cross the bridge. Only bounded numeric counters, utilization, reset timestamps, and a path without its query string are emitted.
- The background validates the sender, origin, top frame, allowed keys, bucket names, units, numeric bounds, and timestamps again before storage or alerts.
- Prompts and replies are never stored or transmitted by COMPANION.
- File conversion stays in the existing sandboxed offscreen pipeline.
- No analytics, telemetry, or third-party service is added.

The channel mailbox exists only during extension startup. It is removed as soon as the MAIN-world observer claims it. Query parameters are excluded from retained source metadata, so identifiers or access values in a usage URL are not stored or shown.

## Why standalone Codex desktop is different

A Manifest V3 Chrome extension can inject into supported browser pages. It cannot inject its content script into a native desktop application shell that is not hosting an extension-enabled web page.

COMPANION therefore supports Codex-aware web surfaces and shared agentic usage that OpenAI exposes on ChatGPT web. It does not claim to modify the standalone Codex desktop interface.

## Troubleshooting

If the widget does not appear:

1. Confirm the extension has access to `chatgpt.com`.
2. Reload the ChatGPT tab after updating the unpacked extension.
3. Open a normal Chat, Work, or Codex-aware web composer.
4. Check COMPANION Settings and confirm the widget is enabled.

If Caveman Mode opens a preview but the message does not send, review the preview and use the ChatGPT send button once. COMPANION deliberately never sends hidden text without a visible user action.

If usage rows are empty, the current OpenAI response may not expose supported counters, or the last reading may have expired. Caveman Mode and file conversion still work normally.
