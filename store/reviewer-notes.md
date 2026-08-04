# Chrome Web Store Reviewer Notes — COMPANION v1.4.0

## Single purpose

COMPANION is one local efficiency layer for supported Claude and ChatGPT web surfaces. It displays provider-reported numeric usage and limits when available, provides optional threshold warnings, offers a user-controlled Lifejacket prompt-compression preview, and converts user-selected files to Markdown locally.

## Account-dependent data

Claude and OpenAI expose different usage fields to different accounts and can change their internal response shapes.

- Claude rows appear only when Claude exposes the corresponding native metric.
- OpenAI rows appear only when a first-party ChatGPT response exposes a supported numeric usage field.
- An OpenAI waiting or empty state is valid when the reviewer account exposes no supported counter.
- COMPANION fails closed by omitting unsupported data instead of estimating or scraping message text.

## OpenAI privacy boundary

The MAIN-world OpenAI observer sees first-party page responses transiently. It normalizes supported numeric fields inside the page before anything crosses into the extension. Raw response bodies, profile fields, headers, cookies, query strings, prompts, replies, and file contents do not cross the bridge.

A random per-page event channel and a second background validation layer protect the boundary.

## Codex boundary

The standalone native Codex desktop application is not a Chrome extension host. COMPANION supports ChatGPT Chat and Work on the web and retains narrow legacy Codex route compatibility when such a route appears. The listing and product UI state this limitation.

## Local file conversion

User-selected files are parsed inside a manifest-declared opaque-origin sandbox with no extension API access and no network access. The `offscreen` permission is used for the privileged relay, not for remote processing.

## `alarms` permission

One bounded Chrome alarm expires a high OpenAI toolbar badge two hours after its observation. The alarm name contains only provider and observation time. Exact ownership matching prevents it from clearing a newer Claude or OpenAI badge.

## Remote code

No remote code is used. All scripts, parser libraries, fonts, icons, and workers ship in the submitted package. Privileged extension pages prohibit remote scripts.

## Developer data collection

The developer receives no extension data. There is no COMPANION backend, analytics, telemetry, advertising, crash reporting, or remote logging.

## Testing

Detailed steps are in `store/test-instructions.md`. No reviewer credential or COMPANION account is required. Provider-specific testing can use the reviewer's own Claude or ChatGPT account.

Support contact: `zgbrenner@gmail.com`
