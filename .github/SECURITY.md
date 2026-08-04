# Security Policy

## Supported version

Security fixes are applied to the latest published COMPANION release. During the v1.3.0 release-candidate period, reports should reference the exact commit or package checksum tested.

## Report privately

Send sensitive reports to **zgbrenner@gmail.com**.

Include:

- COMPANION version or commit SHA
- browser and version
- provider and surface
- clear reproduction steps
- realistic impact
- a minimal proof of concept when safe
- suggested mitigation, if known

Do not send provider passwords, session cookies, access tokens, full private account responses, confidential prompts, replies, or files. Sanitize screenshots and URL query strings.

## Response targets

- Initial acknowledgment: within 48 hours
- Initial triage: within 5 business days
- Status updates: at least every 7 days while an accepted report remains open

These are targets rather than guarantees. High-impact issues involving user content, provider sessions, account modification, remote code, or sandbox escape receive priority.

## Coordinated disclosure

Please allow time to reproduce, fix, test, and distribute a corrected release before publishing technical details. COMPANION will credit reporters who request credit and will not identify reporters who prefer anonymity.

## Public reports

Use a public GitHub issue only for problems that do not expose user data, provider sessions, credentials, or a practical exploit. The bug-report template explains how to sanitize diagnostic information.

## Architecture

The complete permissions, data flow, trust boundaries, sandbox, threat model, and audit guidance are documented in [`docs/SECURITY.md`](../docs/SECURITY.md).
