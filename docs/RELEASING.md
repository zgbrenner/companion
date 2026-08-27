# Releasing COMPANION

COMPANION ships continuously: **merging a version bump to `main` builds, tests, attests, publishes the GitHub release, and submits the package to the Chrome Web Store automatically.** No manual tagging is required.

## How a release ships

1. Bump the version in `manifest.json`, `package.json`, and `package-lock.json` (all three must match), and update the pinned versions in `tests/07-openai-manifest.mjs`, `tests/20-release-readiness.mjs`, and `tests/24-lifejacket-release-contract.mjs`.
2. Add `RELEASE_NOTES_<version>.md` and a `### <version>` section at the top of `CHANGELOG.md`. The release build fails without them.
3. Open a pull request. CI runs the full suite, and the `release-package` pull-request run rehearses the exact release build.
4. Merge to `main`. The `auto-release` workflow then:
   - reads `manifest.json` and checks whether a GitHub release `v<version>` already exists;
   - if the version is new, creates the `v<version>` tag on the merge commit;
   - runs the full `release-package` pipeline: deterministic Lifejacket model build, complete Chromium test suite, model agreement and latency gates, SBOM, checksum verification, build-provenance attestation;
   - publishes the GitHub release with the verified ZIP, checksums, inventory, SBOM, and model-quality report;
   - uploads the same verified ZIP to the Chrome Web Store and submits it for review, publishing automatically when review passes.

Pushes to `main` that do not change the manifest version do nothing — the Chrome Web Store requires every upload to carry a new version, so the version bump is the release trigger.

A `v*` tag pushed by hand and the manual `workflow_dispatch` run of `release-package` continue to work exactly as before.

## If a release run fails

Fix the problem and merge the fix to `main` with the **same version**. The tag has no published release yet, so `auto-release` re-points it at the fixed commit and retries the whole pipeline. Bump the version only when the failed version was already submitted to the store.

## One-time Chrome Web Store setup

The store job is skipped until this is configured. Everything below happens once.

### 1. Dashboard prerequisites (manual)

The Chrome Web Store API cannot create items, so the first submission is manual:

1. Register the developer account (one-time fee) and enable 2-step verification.
2. Create the item in the [developer dashboard](https://chrome.google.com/webstore/devconsole) by uploading a built `dist/companion-<version>.zip` (from `npm run build:extension` or the release artifact).
3. Complete the **Store listing** tab from `store/listing.md` and the artwork in `store/` (five screenshots, promo tile, optional marquee).
4. Complete the **Privacy** tab from `store/permission-justifications.md`, with the privacy policy URL `https://companion.pages.dev/privacy/`.
5. Note the **item ID** (from the item's dashboard URL) and the **publisher ID** (Publisher → Settings).

### 2. Service account (manual)

Following [Google's service-account guide](https://developer.chrome.com/docs/webstore/service-accounts):

1. In a Google Cloud project, enable the **Chrome Web Store API**.
2. Create a service account and download a JSON key. No IAM roles are needed.
3. In the Chrome Web Store dashboard **Account** section, add the service account's email address. Only one service account can be linked per publisher.

### 3. Repository configuration

Under GitHub → Settings:

| Kind | Name | Value |
| --- | --- | --- |
| Secret | `CHROME_WEB_STORE_SERVICE_ACCOUNT_JSON` | The service-account JSON key |
| Secret | `CHROME_WEB_STORE_PUBLISHER_ID` | Publisher ID from the dashboard |
| Secret | `CHROME_WEB_STORE_EXTENSION_ID` | Item ID from the dashboard |
| Variable | `AUTO_PUBLISH_CHROME_WEB_STORE` | `true` to enable store publishing on pushes |
| Variable | `CHROME_WEB_STORE_STAGED_PUBLISH` | Optional. `true` holds approved versions staged for a manual go-live instead of publishing automatically. Staged approvals expire after 30 days. |

The store job runs in the `chrome-web-store` environment; add required reviewers to that environment for an approval gate before any store upload.

## Review semantics worth knowing

- Every submission goes through Chrome Web Store review; "publish on push" means "submit on push, go live when review passes."
- Only one submission can be in review at a time. The pipeline withdraws a still-pending older submission before uploading a newer version.
- The publish call uses `blockOnWarnings`, so validation warnings fail the run loudly instead of shipping quietly.
