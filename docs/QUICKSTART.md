# Quick Start

Claude Companion is a Chrome/Edge extension that shows your real Claude.ai usage under the chat box. This guide covers installing it, first-run setup, and everyday use. For the security model and IT/infosec review, see **[SECURITY.md](SECURITY.md)**.

---

## 1. What you need

- Google Chrome or Microsoft Edge (Chromium), version 111 or newer.
- A Claude.ai account (Free, Pro, Max, Team, or Enterprise).
- The extension's folder on disk (this repository).

No account, sign-up, API key, or server is required by the extension itself.

---

## 2. Install (Developer mode / "Load unpacked")

1. Download or clone this repository to a stable location on disk — a folder you won't move or delete (e.g. `Documents\ClaudeCompanion`). The extension runs from these files in place.
2. Open your browser and go to `chrome://extensions` (or `edge://extensions`).
3. Turn on **Developer mode** (top-right toggle).
4. Click **Load unpacked** and select the extension folder (the one containing `manifest.json`).
5. The extension appears in the list and its icon appears in the toolbar. Pin it if you like.
6. Open **https://claude.ai** and sign in. The widget appears docked directly under the chat box.

> **Tip:** put the folder somewhere it won't be touched. If you later enable one-click updates (step 6 below), the extension keeps its own files current in place — no reinstalling.

---

## 3. Read the widget

![The widget under the chat box](images/widget.png)

- **Spent this session** — how much you've spent since you opened your browser, from Claude's own counter. Covers all your Claude activity in that window (every tab/device on your account).
- **Today** — real spend so far today.
- **Session limit (5-hour), Weekly limit, Weekly Opus limit** — Claude's own rolling limits with reset countdowns. Bars turn amber at 70% and red at 90%.
- **Monthly allowance** — your monthly usage-credit spend and cap (hideable in Settings).
- The **$ / # / $#** button cycles dollars / tokens / both. **⚙** opens Settings. **✕** hides the widget (bring it back from the toolbar popup).

Click the toolbar icon for the popup: session spend, today, this month, a 14-day spend trend, and the same limits — handy when the widget is hidden.

---

## 4. Tour of Settings

Open Settings from the widget's **⚙**, the popup's **Settings** button, or `chrome://extensions` → Details → Extension options. Everything **auto-saves** — there's no Save button; the top bar confirms "All changes saved."

- **Display** — dollars/tokens/both; show or hide the widget; show or hide Caveman Mode; the model used for token estimates.
- **Alerts** — desktop notification when a limit runs hot (85% / 95%); plain-English pace warnings.
- **Claude connection** — show/hide Claude's real limits; show/hide the monthly usage-credit view; a live connection-status panel (detected organization — masked, with reveal/copy — the cached monthly cap, and how long ago it was detected); "Re-detect account"; and a "How the connection works" explainer.
- **Data & privacy** — a summary of what is and isn't stored; **Download CSV** (daily spend history, no chat text); and **Clear all local data** (a clearly separated destructive action).

---

## 5. Caveman Mode (optional — stretch your quota)

Flip the red **Caveman Mode** switch in the widget when you're running low on quota:

- **Brief replies** — Claude is asked, once per conversation, to answer in the fewest words that fully and accurately resolve your request. Turning it on in an existing chat sends the instruction as a message (your draft is preserved); in a new chat it rides on top of your first message.
- **Prompt trimming** — when you send, a preview shows a locally-trimmed version of your prompt with the savings. Choose **Send trimmed**, edit it first, or **Send original**. Nothing is auto-sent, and trimming only deletes filler — it never rewrites your meaning or touches code, quotes, or URLs.
- **File → Markdown** — click the drop zone to pick a PDF/DOCX/PPTX/XLSX/CSV/HTML file; it's converted to lean Markdown locally and dropped into the chat box to paste.

Don't want the feature at all? Turn off **Show Caveman Mode in the widget** in Settings → Display.

---

## 6. Troubleshooting

- **Widget doesn't appear** — make sure you're on `https://claude.ai` and signed in; reload the tab. If Claude changed its page layout, the widget waits for the composer rather than floating in the wrong place.
- **Limits show "Sign in to claude.ai…"** — you're signed out, or the tab hasn't finished loading; sign in and reload.
- **Limits show an org mismatch / "unavailable"** — Settings → Claude connection → **Re-detect account**, then reload a Claude tab.
- **Numbers look off** — dollar figures are ground truth; if the token *range* seems wide, that's intentional (it reflects real uncertainty). If session spend doesn't move after a reply, reload the tab.
- **Reset everything** — Settings → Data & privacy → **Clear all local data**. This never touches your Claude account.

---

## 7. Uninstall

Remove it at `chrome://extensions`. To also wipe locally-stored data first, use Settings → Data & privacy → **Clear all local data**. Your Claude account is unaffected either way.
