# Contributing to Companion

Thanks for helping make Companion better. PRs and issues are welcome.

## Ground rules

Companion's promises are non-negotiable — a PR that breaks any of them won't merge:

1. **Read-only.** No request that can change the user's Claude account, chats, or settings.
2. **Nothing leaves the device.** No telemetry, no analytics, no third-party endpoints. The extension talks only to `claude.ai`.
3. **No prompt/response persistence.** Only numeric usage figures, timestamps, and settings are stored.
4. **Honest numbers.** Dollars come from Claude's own counter; tokens are the only derived value and are always shown as a range, never fake precision.

Read [docs/SECURITY.md](docs/SECURITY.md) before touching `injected.js`, `background.js` message handling, or the sandbox/offscreen converter — the trust boundaries there are deliberate.

## Development setup

There is no build step. The repository *is* the extension:

1. Clone the repo.
2. `chrome://extensions` → enable **Developer mode** → **Load unpacked** → select the repo root.
3. Open [claude.ai](https://claude.ai); the widget appears under the chat box.
4. After editing, click the reload icon on the extension card and refresh the Claude tab.

## Testing

There is no automated test suite yet (contributions welcome). Before submitting:

- Exercise what you changed in a real Chromium session on claude.ai — light and dark theme for UI changes.
- For converter changes, run a real file of each affected format through the drop zone.
- For anything touching `manifest.json` or packaging, run `tools/package-webstore.sh` and confirm it succeeds.

## Style

- Vanilla JS (MV3, no frameworks, no dependencies beyond the vendored parsers).
- Match the surrounding code's comment density — comments explain *why*, especially around trust boundaries and claude.ai DOM/endpoint assumptions.
- Keep the three converter extension lists in sync (`content.js`, `background.js`, `sandbox.js` — see the comment at each).

## Pull requests

- One logical change per PR, with a clear description of the user-visible effect.
- Update `CHANGELOG.md` under the unreleased version.
- If your change affects any claim in `README.md`, `docs/SECURITY.md`, or `store/`, update those too — docs that overclaim are treated as bugs.
