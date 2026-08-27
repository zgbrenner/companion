# COMPANION 1.4.1

COMPANION 1.4.1 completes the Chrome Web Store release pipeline and refreshes the store and launch materials. It contains no extension runtime code changes, and Lifejacket Mode ships unchanged from 1.4.0.

## Continuous release delivery

- Pushing a version bump to the main branch now builds, tests, and attests the package, creates the GitHub release, and uploads and publishes the extension to the Chrome Web Store automatically through a `workflow_call`-based auto-release pipeline.
- Repairs the release-asset guard in CI so the release workflow fails when a required generated launch asset is missing instead of silently skipping the check.
- Removes a leftover temporary source-export workflow from CI.

## Store and launch materials

- Regenerates the promotional tile, marquee, and all five store screenshots as current-brand artwork built from real product renders.
- Unifies screenshot naming under one numbered scheme: `01-overview.png`, `02-claude-usage.png`, `03-chatgpt-work-codex.png`, `04-settings-privacy.png`, and `05-local-efficiency-tools.png` replace the earlier widget-light and popup-light names.
- Updates the store listing and submission documents with the public website links at https://companion.pages.dev.

## Upgrade behavior

- There are no extension behavior, permission, or storage changes from 1.4.0. Installed extensions gain only the new version number.

Nothing is silently submitted, provider values are never estimated, and prompts, replies, files, and raw provider payloads remain local to the extension workflow.
