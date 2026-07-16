# Privacy Policy — Claude Companion

**Last updated: July 16, 2026**

This policy describes how the **Claude Companion** browser extension (the "Extension") handles data. The Extension is an independent, unofficial project and is not affiliated with, endorsed by, or sponsored by Anthropic, PBC. "Claude" is a trademark of Anthropic, PBC.

This policy is hosted alongside the Extension's source code at:
`https://github.com/zgbrenner/claudecompanion/blob/main/store/privacy-policy.md`

---

## 1. What the Extension does

Claude Companion reads usage information that claude.ai already makes available to your own account — spend in dollars, token estimates, and Claude's own rolling usage limits (5-hour session, weekly, Opus, and monthly credits) — and displays it in a widget under the claude.ai chat box and in the toolbar popup. It also offers an optional "Caveman Mode" that locally trims prompts and converts uploaded files to Markdown to help you stretch your usage quota.

The Extension does not modify your Claude account, conversations, or settings in any way. Every request it makes to claude.ai is a read-only `GET`.

## 2. Data collected by the developer

**None.** The developer of Claude Companion does not operate any server that the Extension communicates with, and does not collect, receive, or have access to any data from your use of the Extension. There is no analytics, no crash reporting, no telemetry, and no tracking of any kind.

## 3. Data stored locally on your device

The Extension stores the following data using your browser's built-in `chrome.storage` APIs. This data never leaves your device except as described in Section 4.

| Data | Storage | Purpose |
|---|---|---|
| Your settings (display preferences, alert thresholds, Caveman Mode toggle, etc.) | `chrome.storage.local` | Remember your configuration between sessions |
| Daily spend totals (dollar amounts and derived token ranges) | `chrome.storage.local` | Power the popup's spend history and 14-day trend |
| Your organization's UUID (cached, ≤48 hours) | `chrome.storage.local` | Address the correct claude.ai usage endpoint for your account |
| The learned usage-endpoint path (a URL path only, not any payload) | `chrome.storage.local` | Continue reading your usage data if claude.ai's internal endpoint path changes |
| Notification-dedupe state (which alert thresholds you've already been notified about) | `chrome.storage.local` | Avoid repeat desktop notifications for the same limit crossing |
| The current usage reading and session-spend baseline | `chrome.storage.session` (memory-only, cleared when the browser closes) | Compute your live session spend |

All of the above stays on your device. You can inspect it at any time via your browser's extension storage inspector, and you can erase it at any time — see Section 6.

## 4. Network requests

The Extension communicates with **claude.ai only**. It has no permission to contact, and does not contact, any other host. The requests it makes are:

| Request | Method | Purpose |
|---|---|---|
| `claude.ai/api/organizations` | GET | Discover your organization ID |
| `claude.ai/api/organizations/{org}/usage` | GET | Read your rolling usage limits and monthly credit spend |
| `claude.ai/api/organizations/{org}/overage_spend_limit` | GET | Read your monthly spend cap, where applicable |
| A per-model spend endpoint (path learned by observing claude.ai's own requests — only the URL path is observed, never any request or response payload) | GET | Read per-model spend detail |

All of these requests are **read-only** and are issued using your browser's existing claude.ai session — the same way any page you have open in that tab would authenticate. No request carries a body of your data, and none can change your account, your conversations, or your settings.

## 5. What is never collected

The Extension is built specifically to avoid collecting anything beyond numeric usage data:

- **Your prompts** are never read or transmitted, except transiently in-page (and only locally, never sent anywhere) to offer a local trim preview if you opt into Caveman Mode's prompt trimming.
- **Claude's replies** are never read at all.
- **Uploaded file contents** (Caveman Mode's file→Markdown feature) are parsed entirely on your device, inside a sandboxed page with no network access, and are never transmitted anywhere.
- **Your Claude session/authentication cookie** is never read. The only cookie value the Extension reads is `lastActiveOrg`, a non-secret organization identifier — not a credential — used solely to address the correct usage endpoint.
- **No personal information** (name, email, payment details) is collected by the Extension itself; it only reads the usage numbers described above.

## 6. Permissions this Extension requests, and why

| Permission | Why it's needed |
|---|---|
| `storage` | Save your settings and local spend history on your device |
| `activeTab` | Locate the active Claude tab when you open the toolbar popup |
| `notifications` | Show an optional desktop alert when a usage limit crosses 85% or 95% |
| `offscreen` | Host the local, sandboxed file-conversion pipeline used by Caveman Mode |
| Host access to `https://claude.ai/*` and `https://*.claude.ai/*` | Run the widget and read your usage from claude.ai's own endpoints |

The Extension requests no other permissions and no `<all_urls>` access.

## 7. Data retention and deletion

Locally stored data (Section 3) persists in your browser until you remove it. You can delete it at any time by:

- Using the **"Clear all local data"** button in the Extension's settings page, which erases all Extension storage immediately, or
- Uninstalling the Extension, which removes all of its stored data along with it.

Because no data is transmitted to the developer, there is no server-side copy to request deletion of — deleting it locally is complete deletion.

## 8. Changes to this policy

If this policy changes, the updated version will be published at the same URL with a new "Last updated" date. Material changes (e.g., any change to what data is read or where it goes) will also be noted in the Extension's `CHANGELOG.md`.

## 9. Contact

Questions about this policy or the Extension's data handling can be sent to:

**zgbrenner@gmail.com**

Source code, including this policy, is available at `https://github.com/zgbrenner/claudecompanion`.
