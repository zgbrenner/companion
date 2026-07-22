# Chrome Web Store Submission Checklist — COMPANION v1.2.0

This checklist covers package creation, Chrome Web Store review, controlled testing, and coordinated public launch.

## 1. Developer account and publisher setup

- [ ] Register the publishing Google account in the Chrome Web Store developer dashboard.
- [ ] Pay the one-time developer registration fee shown by Google if the account has not already completed registration.
- [ ] Enable **2-step verification** on the publishing Google account. Chrome Web Store publishing requires it.
- [ ] Verify the developer contact email and monitor it throughout review.
- [ ] Complete the EU Digital Services Act trader or non-trader declaration in the account settings using the status that accurately applies to the developer.
- [ ] Use the same verified publisher identity for future COMPANION updates.

## 2. Repository and policy availability

- [ ] Decide whether the repository will become public before submission. It is currently private.
- [ ] Make `store/privacy-policy.md` available at a public HTTPS URL before entering the privacy-policy field.
- [ ] Ensure the public privacy policy, `store/listing.md`, `store/permission-justifications.md`, `manifest.json`, and the actual extension behavior agree.
- [ ] Confirm the public support destination works. A public GitHub issue tracker is recommended after the repository becomes public.
- [ ] Confirm `zgbrenner@gmail.com` is the intended policy and support contact, or update every document consistently.

## 3. Final source preflight

- [ ] Confirm `manifest.json` contains:
  - [ ] name `COMPANION`
  - [ ] version `1.2.0`
  - [ ] exact Claude and ChatGPT HTTPS host permissions only
  - [ ] `storage`, `activeTab`, `notifications`, `offscreen`, and `alarms`
  - [ ] no `<all_urls>` permission
  - [ ] no broad `tabs` permission
  - [ ] no remote update URL or remote-code loader
- [ ] Confirm `CHANGELOG.md` contains a finalized `1.2.0` section.
- [ ] Confirm `RELEASE_NOTES_1.2.0.md` matches the shipped functionality.
- [ ] Run the full numbered test suite and retain the transcript.
- [ ] Review `docs/SECURITY.md` and `store/reviewer-notes.md` one final time.

## 4. Build and verify the upload package

The release workflow is the preferred source of the upload ZIP.

- [ ] Run `.github/workflows/release-package.yml` with `workflow_dispatch` on the final release commit.
- [ ] Download the generated ZIP and SHA-256 checksum artifact.
- [ ] Confirm the checksum matches locally:

  ```bash
  sha256sum -c companion-1.2.0.zip.sha256
  ```

- [ ] Alternatively, build locally:

  ```bash
  tools/package-webstore.sh
  ```

- [ ] Confirm the ZIP contains exactly the runtime extension roots:
  - `manifest.json`
  - `icons/`
  - `src/`
- [ ] Confirm it does not contain tests, docs, source maps, environment files, editor files, development fonts, Git metadata, or launch materials.
- [ ] Extract the ZIP to a fresh directory and load that extracted directory through `chrome://extensions` as an unpacked extension.
- [ ] Confirm there are no missing assets or extension console errors.

## 5. Real-account smoke test

Test the exact extracted release package, not a working-tree folder.

- [ ] Claude.ai, light theme
- [ ] Claude.ai, dark theme
- [ ] ChatGPT Chat, light theme
- [ ] ChatGPT Chat, dark theme
- [ ] ChatGPT Work if available to the test account
- [ ] A Codex-aware ChatGPT web route if available
- [ ] New conversation and existing conversation
- [ ] Page refresh and in-app navigation
- [ ] Provider-aware toolbar popup
- [ ] Caveman prompt preview with trimmed, original, edited, and cancelled paths
- [ ] One PDF and one Office file conversion
- [ ] Desktop notification toggle
- [ ] Toolbar badge behavior
- [ ] Clear all local data

Record any account-specific data absence as expected when a provider does not expose a supported native counter. Do not treat an honest OpenAI empty state as a failure.

## 6. Store listing fields

Paste the current content from `store/listing.md`.

- [ ] Name: `COMPANION`
- [ ] Summary: verify it remains 132 characters or fewer after any dashboard edit
- [ ] Detailed description: preserve the native-data boundary and non-affiliation statement
- [ ] Category: Productivity
- [ ] Language: English (United States)
- [ ] Support URL: public and working
- [ ] Homepage URL: public and working, preferably the public repository or a dedicated landing page

Do not add unsupported superlatives, provider affiliation, install counts, review counts, awards, rankings, or performance claims.

## 7. Store graphics

Chrome Web Store screenshot dimensions must be consistent.

- [ ] Store icon: `icons/icon128.png`
- [ ] Small promotional tile: `store/promo-tile-440x280.png`
- [ ] Optional marquee: `store/marquee-1400x560.png`
- [ ] Upload up to five 1280×800 screenshots:
  1. `store/screenshots/01-overview.png`
  2. `store/screenshots/02-claude-usage.png`
  3. `store/screenshots/03-chatgpt-work-codex.png`
  4. `store/screenshots/04-settings-privacy.png`
  5. `store/screenshots/05-local-efficiency-tools.png`
- [ ] Inspect every image at native size and at a small thumbnail size.
- [ ] Confirm visible numbers are clearly presented as product examples or actual seeded product renders, not claims about a user's account.
- [ ] Confirm no Anthropic, Claude, OpenAI, ChatGPT, Work, or Codex logo is used as COMPANION branding.

## 8. Privacy practices tab

Use `store/permission-justifications.md`.

- [ ] Paste the single-purpose description.
- [ ] Justify `storage`.
- [ ] Justify `activeTab`.
- [ ] Justify `notifications`.
- [ ] Justify `offscreen`.
- [ ] Justify `alarms`.
- [ ] Justify Claude host permissions.
- [ ] Justify ChatGPT and OpenAI web host permissions.
- [ ] Remote code: select **No, I am not using remote code**.
- [ ] Disclose Website content.
- [ ] Disclose Personal communications because an enabled, user-initiated Caveman preview transiently handles draft prompt text locally.
- [ ] If the current dashboard separately lists User activity or User-generated content, select the categories that accurately describe composer sends and user-selected file conversion.
- [ ] Select all required Limited Use certifications that remain true.
- [ ] Enter the public privacy-policy URL.

Accuracy is more important than minimizing the number of disclosed categories. Local-only processing still needs to be disclosed.

## 9. Reviewer instructions

- [ ] Paste or attach the relevant material from `store/test-instructions.md`.
- [ ] Add `store/reviewer-notes.md` when the dashboard provides a reviewer note field.
- [ ] Explain that OpenAI usage rows are account-dependent and an empty state is valid when OpenAI exposes no supported counter.
- [ ] Explain the standalone Codex desktop boundary.
- [ ] Do not provide personal provider credentials in reviewer notes or repository files.

## 10. Distribution and publishing controls

- [ ] Choose the intended distribution regions.
- [ ] For a public launch, select Public visibility.
- [ ] Use **deferred publishing** so approval does not automatically trigger the public launch before the final smoke test and launch materials are ready.
- [ ] If the dashboard supports a trusted-tester or unlisted phase that fits the launch plan, use it for a brief approved-package test before public publication.
- [ ] Submit the package for review.
- [ ] Monitor the dashboard and developer email for questions or policy notices.

## 11. After approval, before public publication

- [ ] Test the approved package with the intended release account and at least one additional trusted tester.
- [ ] Add the final Chrome Web Store URL to `README.md`, launch copy, Product Hunt draft, and social posts.
- [ ] Decide whether to make the GitHub repository public. Public source is an important trust and growth asset for this privacy-focused extension.
- [ ] Set repository description, topics, social preview, issue templates, and discussions if enabled.
- [ ] Prepare the `v1.2.0` GitHub release using `RELEASE_NOTES_1.2.0.md`.
- [ ] Confirm the public privacy-policy and support links work while signed out.
- [ ] Confirm the launch assets and posts contain the final store URL.

## 12. Coordinated public launch

Follow `docs/launch/LAUNCH_PLAYBOOK.md`.

- [ ] Publish the approved Chrome Web Store listing.
- [ ] Publish the GitHub repository if public source is part of the launch.
- [ ] Publish the `v1.2.0` GitHub release.
- [ ] Launch on Product Hunt only when the listing is live and installable.
- [ ] Publish the Hacker News, Reddit, X, LinkedIn, and community posts at sensible intervals rather than simultaneously spamming every channel.
- [ ] Ask for feedback and honest reviews after users have experienced the product. Do not coordinate votes, incentivize ratings, or mass-message strangers.
- [ ] Respond quickly to install problems, permission questions, and provider-layout regressions.

## 13. First-week operations

- [ ] Review Chrome Web Store installs, weekly users, ratings, reviews, and support messages daily.
- [ ] Review GitHub issues and discussions daily if the repository is public.
- [ ] Track launch feedback using `docs/launch/PRIVACY_SAFE_GROWTH_METRICS.md`.
- [ ] Prioritize broken installation, data-accuracy, privacy, and composer-integration issues over new features.
- [ ] Ship a corrective release only after reproducing and testing the issue.
- [ ] Update the listing or privacy policy immediately if a public claim is inaccurate.
