# Chrome Web Store Reviewer Test Instructions — COMPANION v1.4.1

These instructions are written for Chrome Web Store review and internal release testing.

## What the reviewer needs

- A Chromium-based browser that supports Manifest V3.
- A signed-in Claude.ai or ChatGPT.com account for provider-specific behavior.
- No COMPANION account, API key, developer credential, model download, or test credential.

OpenAI and Claude expose different data to different account types. The extension remains reviewable when a reviewer account exposes no native usage counter.

## Installation

1. Extract the submitted ZIP.
2. Open `chrome://extensions`.
3. Enable **Developer mode**.
4. Choose **Load unpacked**.
5. Select the extracted directory containing `manifest.json`.
6. Confirm the extension loads as **COMPANION**, version `1.4.1`, with the Orbit C icon.

The ZIP already contains the quantized model and WebAssembly runtime. No model is fetched after installation.

## Basic Settings test

1. Pin COMPANION to the toolbar.
2. Open the popup on a non-provider tab.
3. Confirm the popup loads and offers access to Settings.
4. Open Settings.
5. Confirm the Display, Lifejacket, Alerts, Connections, and Data & privacy sections render.
6. Toggle one setting and confirm the status changes to **All changes saved**.
7. Use **Restore defaults** and confirm Lifejacket is off while its three child tools remain enabled as saved defaults.

## Claude.ai usage test

1. Sign in to `https://claude.ai/`.
2. Open a conversation or start a new one.
3. Reload the page after installing COMPANION.
4. Confirm the usage widget and Lifejacket panel appear beside the active composer.
5. Confirm both follow Claude's light or dark appearance.
6. Open the toolbar popup while the Claude tab is active.
7. The popup should show native Claude usage and limit information available to the reviewer account.
8. When a metric is unavailable, COMPANION should omit the unsupported row rather than display a fabricated value.
9. Open Settings, hide one Claude metric, and confirm it is hidden in both the widget and popup after refresh.

Claude usage requests are read-only and same-origin. COMPANION does not modify the account, subscription, settings, or conversation.

## ChatGPT Chat usage test

1. Sign in to `https://chatgpt.com/` or the supported legacy `https://chat.openai.com/` origin.
2. Open Chat or start a new conversation.
3. Reload the page after installing COMPANION.
4. Confirm the usage widget and Lifejacket panel appear beside the active composer.
5. Confirm the surface label shows **Chat** and the controls follow the page appearance.
6. Open the toolbar popup while the ChatGPT tab is active.
7. If OpenAI exposes a supported native numeric counter, COMPANION may render it.
8. If OpenAI exposes no supported counter, the correct result is an honest waiting or empty state.

COMPANION does not create account, billing, quota, or usage requests to OpenAI. It passively observes relevant first-party responses and normalizes bounded numeric fields before forwarding them into the extension.

## Work and Codex-aware web test

Availability depends on the reviewer account and current ChatGPT interface.

1. Navigate to ChatGPT Work or a Codex-aware web route if available.
2. Confirm COMPANION updates the surface label automatically.
3. Confirm Work uses the restrained violet context accent.
4. Confirm Codex-aware web state uses the graphite and indigo context accent.
5. Confirm no manual provider or surface setting is required.

The native Codex desktop application is not a Chrome extension host. COMPANION supports Codex-aware web surfaces and shared agentic usage exposed through ChatGPT web.

## Lifejacket controls test

1. Open Settings and confirm **Show Lifejacket Mode beside the composer** is on.
2. Confirm the Lifejacket master switch is separate from these child switches:
   - Shorten the user's prompt
   - Ask for shorter answers
   - Convert files to Markdown
3. Turn the Lifejacket master on.
4. Return to a Claude or ChatGPT composer.
5. Confirm the panel reflects all four switch states.
6. Turn one child off in the panel and confirm the corresponding Settings switch changes after reopening Settings.
7. Turn the master off and confirm child choices remain saved but inactive.

## Prompt-compression test

1. Turn on the Lifejacket master and **Shorten the user's prompt**.
2. Type a multi-sentence prompt that does not contain private information.
3. Initiate a send.
4. Confirm COMPANION intercepts the send and displays **Compressing with the bundled local Q8 model…** on first use.
5. Confirm an editable preview appears with:
   - **Send optimized**
   - **Send original**
   - **Cancel**
6. Choose **Cancel** and confirm no message is sent and the original draft remains.
7. Repeat and choose **Send original**. Confirm the original text is submitted.
8. Repeat and choose **Send optimized**. Confirm only the visible preview text is submitted.

A result may report **no safe reduction**. That is valid: the model ran, but COMPANION kept the original because compression was ineffective or failed a safety gate.

## Protected-content and fallback test

Use a non-sensitive prompt such as:

```text
Do not publish ticket SEC-1842 before 2026-09-01. Review `validateSender()` and https://example.com/status.
```

1. Initiate a Lifejacket send.
2. Inspect the preview.
3. Confirm `Do not`, `SEC-1842`, `2026-09-01`, ``validateSender()``, and the URL remain unchanged.
4. Confirm **Send original** and **Cancel** remain available.

For text with poor tokenizer coverage, Lifejacket may keep a chunk unchanged and display a model-coverage warning. It does not send automatically.

## Reply-brevity test

1. Turn prompt compression off and **Ask for shorter answers** on.
2. Type `Explain the deployment result.` and initiate a send.
3. Confirm the preview retains the original prompt and visibly ends with:

```text
Reply briefly. Lead with the answer and keep every necessary fact, step, and caveat.
```

4. Cancel the preview.
5. Turn reply brevity off and confirm the suffix no longer appears.

## File conversion test

1. Turn on the Lifejacket master and **Convert files to Markdown**.
2. Type `Existing draft text` in the provider composer.
3. Use the Lifejacket file control to choose a small `.txt`, `.md`, `.csv`, `.pdf`, or Office document.
4. Confirm a local conversion status appears.
5. Confirm the converted Markdown is appended after the existing draft instead of replacing it.
6. Confirm no file is uploaded to a COMPANION server.

Markdown and text are read directly. Other supported formats are parsed in a manifest-declared opaque-origin sandbox with no extension API or network access.

## Notifications and badge test

Native provider data is required to exercise actual threshold crossings. Static review can verify:

1. Settings contains the optional desktop-notification control.
2. Settings contains the optional toolbar-badge control.
3. `alarms` is used only for stale-warning expiry and badge reconciliation.
4. Alarm state contains no prompt, reply, file, or raw provider payload.

## Clear local data test

1. Open Settings.
2. Scroll to **Data & privacy**.
3. Choose **Clear all local data**.
4. Accept the confirmation.
5. Confirm Settings reports that local COMPANION data has been cleared.
6. Confirm provider accounts and conversations remain unchanged.

## Expected network destinations

At runtime, privileged extension pages can connect only to packaged resources and exact provider HTTPS hosts declared in `manifest.json`:

- `claude.ai` and its subdomains;
- `chatgpt.com` and its subdomains;
- `chat.openai.com`.

There is no COMPANION server, analytics endpoint, remote logger, model host, font CDN, or remote-code host.

## Support during review

Questions can be sent to `zgbrenner@gmail.com`. Do not send provider passwords, session cookies, account tokens, private prompts, or private files.
