# Chrome Web Store — Privacy Practices Tab

Paste-ready answers for the "Privacy practices" tab of the CWS Developer Dashboard listing for **Companion**.

---

## Single purpose description

```
Companion shows the signed-in user their own Claude.ai usage — spend in dollars, token
estimates, and Claude's own rolling usage limits (session, weekly, Opus, and monthly credits) —
in a widget under the claude.ai chat box and in a toolbar popup, with optional alerts as limits
are approached. All functionality serves this single purpose of surfacing the user's existing
Claude.ai usage data to them at a glance.
```

---

## Permission justifications

### storage

```
Used to save the user's own settings (display and alert preferences) and locally computed spend
history on-device, so they persist across browser sessions. No sync storage is used; nothing
stored is transmitted anywhere.
```

### activeTab

```
Used only when the user opens the toolbar popup, to identify whether the active tab is a
claude.ai tab so the popup can display that tab's live usage data. The extension does not use
the broader "tabs" permission and does not track browsing across sites.
```

### notifications

```
Used to show an optional, user-configurable desktop notification when a Claude usage limit
crosses 85% or 95%, so the user gets a heads-up before hitting a wall mid-conversation. Users can
disable this at any time in Settings.
```

### offscreen

```
Used to host the local file-conversion pipeline for the optional "Caveman Mode" feature, which
converts a user-selected file (PDF/Office document) to Markdown entirely on-device. The offscreen
document relays file bytes to a sandboxed, network-isolated page and returns the converted text;
it does not itself parse untrusted file formats and has no network access for this purpose.
```

### Host permission justification (https://claude.ai/*, https://*.claude.ai/*)

```
The extension's entire purpose is to read and display the signed-in user's own Claude.ai usage
data and to run its widget UI on claude.ai. Host access is scoped exclusively to claude.ai and
its subdomains — no other origin is requested. All requests are read-only GETs to claude.ai's own
usage endpoints, authenticated by the user's existing browser session; no request can modify the
user's account, conversations, or settings.
```

---

## Are you using remote code?

**Answer: No.**

```
All executable code ships inside the extension package; nothing is fetched or evaluated from a
remote server at runtime. The extension bundles two third-party open-source libraries locally as
part of the package — officeparser (Office document parsing) and a Mozilla PDF.js worker (PDF
parsing) — both used only by the optional local file-conversion feature. These files are static,
version-pinned assets committed to the extension's own package, not code loaded from a CDN or
external host at runtime; they execute inside a sandboxed page with no network access. This
satisfies "no remote code" under the Chrome Web Store's definition, since no code is retrieved
from the network after installation.
```

---

## Data usage disclosure checklist

The CWS "Data collected" categories to check, and why:

### Categories to check

| Category | Check? | Reasoning |
|---|:---:|---|
| Website content | **Yes** | The extension reads numeric usage data (spend, limits) from claude.ai pages/endpoints to display it back to the user. This is processed and stored **entirely on-device** — see below. |

### Categories to leave unchecked

| Category | Check? | Reasoning |
|---|:---:|---|
| Personally identifiable information | No | No name, address, or contact info is read or stored |
| Health information | No | Not applicable |
| Financial and payment information | No | Dollar figures shown are Claude's own usage-credit readout, not payment/billing credentials; no payment data is read |
| Authentication information | No | The session/auth cookie is never read; only a non-secret org-ID cookie value is used |
| Personal communications | No | Prompt and reply text is never read or stored |
| Location | No | Not applicable |
| Web history | No | Only the active claude.ai tab is inspected via `activeTab`, and only to locate it — no browsing history is read or stored |
| User activity | No | No clicks/keystrokes/scroll tracked; Caveman Mode's local prompt-trim preview is ephemeral and never persisted or transmitted |

### For each category checked ("Website content"), required certifications

- **Is the data being sold to third parties?** No.
- **Is the data being used for purposes unrelated to the item's core functionality?** No — it is used exclusively to display the user's own usage back to them.
- **Is the data being used to determine creditworthiness or for lending purposes?** No.

### Required certification statements (tick all — all are true for this extension)

- ☑ I do not sell or transfer user data to third parties outside of approved use cases.
- ☑ I do not use or transfer user data for purposes unrelated to my item's single purpose.
- ☑ I do not use or transfer user data to determine creditworthiness or for lending purposes.

### Recommended free-text summary for the disclosure form

```
The only data the extension reads is the user's own Claude.ai usage numbers (spend, limits),
fetched read-only from claude.ai using the user's existing session. This data is processed and
stored exclusively on the user's device (chrome.storage) to render the widget and popup. It is
never transmitted to the developer or any third party, never sold, and never used for any
purpose beyond displaying it back to the same user.
```
