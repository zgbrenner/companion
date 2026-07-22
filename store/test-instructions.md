# Chrome Web Store Reviewer Test Instructions — COMPANION v1.2.0

These instructions are written for Chrome Web Store review and can also be used for internal release testing.

## What the reviewer needs

- A Chromium-based browser that supports Manifest V3.
- A signed-in Claude.ai or ChatGPT.com account for provider-specific behavior.
- No COMPANION account, API key, developer credential, or test credential is required.

OpenAI and Claude expose different data to different account types. The extension must remain reviewable even when a reviewer account exposes no native usage counter.

## Installation

1. Extract the submitted ZIP.
2. Open `chrome://extensions`.
3. Enable Developer mode.
4. Choose **Load unpacked**.
5. Select the extracted ZIP directory containing `manifest.json`.
6. Confirm the extension loads as **COMPANION**, version `1.2.0`, with the Orbit C icon.

## Basic popup test without provider data

1. Pin COMPANION to the browser toolbar.
2. Open the popup on a non-provider tab.
3. Confirm the popup loads without an error and offers access to Settings.
4. Open Settings.
5. Confirm the Display, Alerts, Connections, and Data & privacy sections render.
6. Toggle one setting and confirm the status changes to **All changes saved**.
7. Use **Restore defaults** and confirm the setting returns to its default.

## Claude.ai test

1. Sign in to `https://claude.ai/`.
2. Open a normal conversation or start a new one.
3. Reload the page after installing COMPANION.
4. Confirm the COMPANION widget appears beneath the active composer.
5. Confirm the widget follows Claude's light or dark appearance.
6. Open the toolbar popup while the Claude tab is active.
7. The popup should show any native Claude usage and limit information available to the reviewer account.
8. When a metric is unavailable, COMPANION should omit the unsupported row rather than display a fabricated value.
9. Open Settings, hide one Claude metric, and confirm it is hidden in both the widget and popup after refresh.

Claude usage requests are read-only and same-origin. COMPANION does not modify the account, subscription, settings, or conversation.

## ChatGPT Chat test

1. Sign in to `https://chatgpt.com/` or the supported legacy `https://chat.openai.com/` origin.
2. Open Chat or start a new conversation.
3. Reload the page after installing COMPANION.
4. Confirm the COMPANION widget appears beneath the active composer.
5. Confirm the surface label shows **Chat**.
6. Confirm the widget follows ChatGPT's light or dark appearance.
7. Open the toolbar popup while the ChatGPT tab is active.
8. If OpenAI exposes a supported native numeric counter to the reviewer account, COMPANION may render the corresponding usage row.
9. If OpenAI exposes no supported counter, the correct result is an honest waiting or empty state. This is expected and is not a broken feature.

COMPANION does not create account, billing, quota, or usage requests to OpenAI. It passively observes first-party page responses and normalizes supported numeric fields inside the page before forwarding them to the extension.

## Work and Codex-aware web test

Availability depends on the reviewer account and current ChatGPT interface.

1. Navigate to ChatGPT Work or a Codex-aware web route if available.
2. Confirm COMPANION updates the surface label automatically.
3. Confirm Work uses the restrained violet context accent.
4. Confirm Codex-aware web state uses the graphite and indigo context accent.
5. Confirm no manual provider or surface setting is required.

The standalone native Codex desktop application is not a Chrome extension host. COMPANION supports Codex-aware web surfaces and shared agentic usage that OpenAI exposes on ChatGPT web.

## Caveman Mode test

1. Open COMPANION Settings and ensure **Show Caveman Mode in the widget** is enabled.
2. Return to a supported Claude or ChatGPT composer.
3. Turn on Caveman Mode in the widget.
4. Type a multi-sentence prompt in the provider composer.
5. Initiate a send.
6. Confirm COMPANION opens a local preview instead of silently sending.
7. Confirm the preview offers these paths:
   - use the trimmed prompt
   - edit the trimmed prompt
   - send the original prompt
   - cancel
8. Cancel the preview and confirm no message is sent.

Prompt text is handled transiently in the page for this user-facing preview and is not written to extension storage or sent to the developer.

## File conversion test

1. In the COMPANION widget, choose the local file-conversion control.
2. Select a small `.txt`, `.md`, `.csv`, `.pdf`, or Office document.
3. Confirm a conversion status appears.
4. Confirm the resulting Markdown is offered to the active composer.
5. Confirm no file is uploaded to a COMPANION server.

The privileged offscreen page only relays bytes. Parsing runs in a manifest-declared opaque-origin sandbox with no extension API access and no network access.

## Notifications and badge test

Native provider data is required to exercise actual threshold crossings. Static review can verify:

1. Settings contains the optional desktop-notification control.
2. Settings contains the optional toolbar-badge control.
3. `alarms` is used only to expire a stale OpenAI badge after two hours.
4. The alarm stores only provider and observation-time ownership metadata.

## Clear local data test

1. Open Settings.
2. Scroll to **Data & privacy**.
3. Choose **Clear all local data**.
4. Accept the confirmation.
5. Confirm Settings reports that local COMPANION data has been cleared.
6. Confirm provider accounts and conversations remain unchanged.

## Expected network destinations

Privileged extension pages can connect only to packaged resources and exact provider HTTPS hosts declared in `manifest.json`:

- `claude.ai` and its subdomains
- `chatgpt.com` and its subdomains
- `chat.openai.com`

There is no COMPANION server, analytics endpoint, remote logger, font CDN, or remote-code host.

## Support during review

Questions can be sent to `zgbrenner@gmail.com`. Do not send provider passwords, session cookies, or account tokens.
