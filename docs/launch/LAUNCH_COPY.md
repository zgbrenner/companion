# COMPANION v1.4.1 Launch Copy

Replace `[CHROME WEB STORE URL]` and `[GITHUB URL]` only after those destinations are public and working.

Every post should link directly to an installable or useful destination. Do not use a tracking redirect, misleading install button, coordinated voting request, or review incentive.

## Core positioning

### Product name

**COMPANION**

### Primary tagline

**Private usage and efficiency tools for Claude and ChatGPT**

### Alternative taglines

- Native AI usage when available. Local tools always.
- Finish more work before the limit.
- Native numbers or nothing.
- One local companion for Claude and ChatGPT.

### One-sentence description

COMPANION is a privacy-first Chrome extension that shows provider-reported Claude and ChatGPT usage when available, warns before native limits run hot, and adds local Lifejacket prompt-compression and file-to-Markdown tools.

### Launch links

- Install: `[CHROME WEB STORE URL]`
- Source and documentation: `[GITHUB URL]`

## Product Hunt

### Name

COMPANION

### Tagline

Private usage and efficiency tools for Claude and ChatGPT

### Short description

COMPANION automatically adapts to Claude, ChatGPT Chat, and ChatGPT Work, with narrow legacy Codex route compatibility when such a route appears. It shows native numeric usage when providers expose it, warns before trustworthy limits run hot, trims prompts locally with your approval, and converts files to Markdown in a no-network sandbox. No account, analytics, telemetry, or developer backend.

### Topics

Choose the closest current Product Hunt topics, prioritizing:

- Chrome Extensions
- Productivity
- Artificial Intelligence
- Privacy
- Developer Tools

### Maker comment

```
Hi Product Hunt,

I built COMPANION because I kept running into the same problem: Claude and ChatGPT are where a lot of work happens now, but usage visibility is fragmented, easy to miss, and often replaced by token estimates that look more certain than they are.

COMPANION follows one rule: native numbers or nothing.

On Claude, it shows the usage and limit data Claude exposes to the signed-in account, including exact usage-credit spend, rolling limits, reset times, and local history. On ChatGPT web surfaces, it shows only supported numeric usage, quota, credit, limit, reset, or token fields that OpenAI exposes to the page. When a trustworthy value is unavailable, it says so instead of guessing.

It also includes local Lifejacket Mode for concise replies, conservative Q8 prompt compression with a visible review, and sandboxed file-to-Markdown conversion. Prompts, replies, files, and raw OpenAI account responses are not sent to me. There is no COMPANION server, analytics, or telemetry.

The project supports Claude, ChatGPT Chat, and ChatGPT Work on the web. Narrow legacy Codex route compatibility is retained when such a route appears; the standalone native Codex desktop app cannot host a Chrome extension, so that boundary is stated clearly.

I would especially value feedback on three things:

1. Is the native-data boundary easy to understand?
2. Does the widget feel useful without getting in the way?
3. Which provider layouts or plans need better support?

Install: [CHROME WEB STORE URL]
Source and security documentation: [GITHUB URL]

Thanks for taking a look.
```

### First reply when someone asks why usage is missing

```
That can be expected. OpenAI exposes different account data on different plans and surfaces. COMPANION only renders supported numeric fields that actually appear in first-party ChatGPT responses. It deliberately leaves an honest empty state rather than inferring a quota from chat text.
```

## Hacker News

### Title

```
Show HN: COMPANION, a private local usage and efficiency layer for Claude and ChatGPT
```

### Post body

```
I built a Manifest V3 extension called COMPANION for people who spend a lot of time in Claude or ChatGPT and do not want an unexpected usage limit to interrupt the work.

The design rule is “native numbers or nothing.”

For Claude, it reads the signed-in account’s own usage and limit endpoints and shows exact usage-credit spend, rolling limits, reset times, and local history. For ChatGPT web surfaces, it passively observes first-party responses and normalizes only supported numeric usage, quota, credit, limit, reset, or token fields inside the page. Raw account responses do not cross into the extension. If OpenAI exposes nothing useful for that account, the UI says it is waiting instead of showing an estimate.

The extension also has an optional local Lifejacket preview and local file-to-Markdown conversion. File parsing runs in an opaque-origin sandbox with no network or extension API access. There is no backend, telemetry, analytics, remote code, or broad all-sites permission.

A few implementation details that may be interesting here:

- exact Claude and ChatGPT HTTPS origins only
- random per-page OpenAI event channels established at document_start
- validation in both the isolated content script and service worker
- query strings stripped from retained source paths
- serialized ownership for the one shared toolbar badge
- bounded expiry alarms for stale OpenAI warnings
- locally bundled fonts and parsers
- unminified source and a Chromium regression suite

It supports Claude, ChatGPT Chat, and Work on the web. A Chrome extension cannot inject into the standalone native Codex desktop shell, so it does not claim to; narrow legacy route compatibility is only conditional on such a web route appearing.

Install: [CHROME WEB STORE URL]
Source: [GITHUB URL]

I am interested in feedback on the privacy boundary, provider-response normalization, and places where the UI breaks as these sites change.
```

### Technical follow-up comment

```
The OpenAI path does not issue usage or billing requests. A MAIN-world observer sees first-party page responses, reduces recognized shapes to a strict numeric schema, and emits the normalized JSON on a random event channel. The isolated script validates it again, then the service worker validates sender, top frame, origin, keys, bucket names, units, timestamps, value ranges, and payload size before storing the latest snapshot.

The extension package and security notes are in the repository. I would welcome specific threat-model critiques.
```

## Reddit

Read each community's current rules before posting. Use only the version relevant to that community and participate in the discussion after posting.

### Claude community version

**Suggested title**

```
I made a local Claude usage meter that now also follows me into ChatGPT
```

**Body**

```
I originally built COMPANION because Claude’s usage information was useful but too far away from the place where I was actually working.

It docks under the Claude composer and shows the native spend and limit data the account exposes: session and weekly limits, Opus usage, reset times, exact usage-credit spend, local history, and optional warnings before a limit runs hot.

The new v1.4 release also works on ChatGPT Chat and Work, so Lifejacket's local prompt-compression, concise-reply, and file-to-Markdown tools can follow the same workflow. OpenAI usage rows only appear when OpenAI exposes supported numeric data. It does not estimate missing quotas.

Privacy was the main constraint: no backend, analytics, telemetry, prompt storage, or raw OpenAI response storage. File conversion runs locally in a no-network sandbox.

Install: [CHROME WEB STORE URL]
Source and security notes: [GITHUB URL]

I would appreciate reports on Claude plans or layouts where a native metric is missing or mounted awkwardly.
```

### ChatGPT community version

**Suggested title**

```
I built a privacy-first ChatGPT companion that refuses to invent usage numbers
```

**Body**

```
I have been working on COMPANION, a local Chrome extension for ChatGPT Chat, Work, and Claude, with narrow compatibility handling for legacy Codex web routes.

The ChatGPT integration follows a strict rule: it renders only numeric usage, quota, credit, limit, reset, or token fields that OpenAI actually exposes in first-party page responses. Raw account responses stay in the page, and an account with no supported counter gets an honest empty state instead of a token-based guess.

It also adds an optional concise-response mode, local Lifejacket prompt-compression preview, and local file-to-Markdown conversion. Nothing is silently sent, and the file parser has no network access.

There is no COMPANION account, backend, analytics, or telemetry.

Install: [CHROME WEB STORE URL]
Source: [GITHUB URL]

I am looking for feedback from people on different ChatGPT plans because OpenAI exposes different data to different accounts.
```

### Privacy community version

**Suggested title**

```
Open-source extension design: normalize AI usage data in-page so raw account responses never cross the boundary
```

**Body**

```
I built a Chrome extension called COMPANION and tried to make its privacy boundary reviewable rather than relying on a promise that data is “local.”

For ChatGPT, the MAIN-world observer reduces first-party usage responses to a strict numeric schema before anything crosses into the extension. Raw response bodies, profile fields, cookies, headers, query strings, prompts, replies, and files do not cross that bridge. The isolated content script and background both validate the message.

For local file conversion, parsing runs in an opaque-origin sandbox with no extension APIs and no network egress. The extension has exact Claude and ChatGPT host permissions, no all-sites permission, no broad tabs permission, and no backend or telemetry.

The code and threat model are public here: [GITHUB URL]

I would welcome criticism of the trust boundaries, data disclosures, and anything the security documentation misses.
```

### Productivity community version

**Suggested title**

```
A small tool for finishing work before Claude or ChatGPT limits interrupt it
```

**Body**

```
COMPANION is a local Chrome extension I built around a simple workflow problem: usage limits are easy to ignore until they stop the work.

It puts provider-reported usage near the composer, provides optional warnings, and includes local tools for shorter replies, conservative prompt trimming, and file-to-Markdown conversion. It automatically follows Claude and supported ChatGPT web surfaces.

The extension does not require an account and has no analytics or telemetry. It also refuses to show a made-up usage estimate when a provider exposes no trustworthy number.

Install: [CHROME WEB STORE URL]
Details: [GITHUB URL]

I would be interested in whether the widget is helpful or becomes visual noise in a real workday.
```

## X

### Single post

```
I built COMPANION: one private usage and efficiency layer for Claude and ChatGPT.

• native usage only when providers expose it
• warnings before trustworthy limits run hot
• local prompt trimming
• sandboxed file → Markdown
• no account, analytics, telemetry, or backend

[CHROME WEB STORE URL]
[GITHUB URL]
```

### Thread

**Post 1**

```
Introducing COMPANION v1.2.

One local Chrome extension for Claude, ChatGPT Chat, and Work, with narrow compatibility handling for legacy Codex web routes.

The rule: native numbers or nothing.
```

**Post 2**

```
On Claude, COMPANION shows the account’s native usage-credit spend, rolling limits, resets, and local history.

On ChatGPT web, it renders only supported numeric usage fields that OpenAI actually exposes. No counter means an honest empty state, not a guess.
```

**Post 3**

```
It also includes:

• concise-response mode
• conservative local prompt preview
• local PDF and Office file → Markdown conversion
• optional limit badges and notifications
```

**Post 4**

```
Privacy boundaries:

• no COMPANION server
• no analytics or telemetry
• prompts and replies are not stored
• raw OpenAI responses stay in the page
• file parsing runs in a no-network sandbox
• exact provider hosts only
```

**Post 5**

```
Install: [CHROME WEB STORE URL]
Source and security architecture: [GITHUB URL]

Feedback on provider plans, page layouts, and privacy assumptions is especially useful.
```

## LinkedIn

```
I just released COMPANION v1.2, a privacy-first Chrome extension for people who work heavily in Claude and ChatGPT.

The problem was simple: usage information is fragmented and easy to miss until a limit interrupts the work. Many tools replace missing data with token estimates that look more exact than they are.

COMPANION takes the opposite approach: native numbers or nothing.

On Claude, it displays the native usage and limit information available to the signed-in account. On ChatGPT web surfaces, it shows only supported numeric fields that OpenAI exposes in first-party page responses. When the data is unavailable, it says so.

It also includes local tools for concise replies, conservative prompt trimming, and file-to-Markdown conversion. There is no COMPANION account, backend, analytics, or telemetry. Prompts and replies are not stored, raw OpenAI account responses stay inside the page, and file parsing runs in a no-network sandbox.

It supports Claude, ChatGPT Chat, and ChatGPT Work on the web. The standalone native Codex desktop application is outside the scope of a Chrome extension, and the product says that clearly.

Install: [CHROME WEB STORE URL]
Source and security documentation: [GITHUB URL]

I would value honest feedback from people who use different provider plans and workflows.
```

## Existing group chat or community

```
I just released something I have been working on called COMPANION. It is a local Chrome extension that sits under Claude or ChatGPT and helps you see native usage when the provider exposes it, warns before a real limit runs hot, and gives you local tools for shorter prompts, shorter replies, and file-to-Markdown conversion.

The privacy part was non-negotiable: no account, analytics, telemetry, or backend. It does not store chats, and it leaves missing OpenAI usage blank instead of making up a number.

Install: [CHROME WEB STORE URL]
Source: [GITHUB URL]

I would genuinely appreciate bug reports or feedback on anything confusing.
```

## Personal outreach to someone you already know

```
Hey, I released the Chrome extension I mentioned. COMPANION works across Claude and ChatGPT, puts native usage near the composer when it is available, and includes local prompt and file tools. It has no backend or telemetry.

You use [Claude/ChatGPT] pretty heavily, so your feedback on the first five minutes would be especially useful. No pressure to post anything. I mainly want to know where the setup or product story is confusing.

[CHROME WEB STORE URL]
```

## Honest review request after demonstrated value

Use only after the person has used COMPANION and said it helped.

```
I am glad COMPANION helped. An honest Chrome Web Store review would make it easier for other people to evaluate the extension, especially because privacy-focused tools depend on user trust. Please mention whatever was genuinely useful or frustrating. Here is the review page: [CHROME WEB STORE REVIEW URL]
```

## Support response templates

### Missing OpenAI data

```
Thanks for reporting this. OpenAI exposes different account data by plan and surface. COMPANION deliberately renders only supported numeric fields that appear in first-party ChatGPT responses. Please share the surface name, browser version, and whether the widget shows a waiting state. Do not share cookies, account tokens, prompts, or raw private account data.
```

### Widget did not appear

```
Thanks. Please share the provider URL path without query parameters, browser version, light or dark theme, and whether a page refresh after installation changes the result. A screenshot with conversation content removed is helpful. Do not send login credentials or session data.
```

### Privacy question

```
COMPANION has no developer backend, analytics, or telemetry. Claude usage reads are same-origin and read-only. ChatGPT raw account responses are normalized inside the page before bounded numeric fields cross into the extension. Prompt text is handled only for an enabled, user-initiated local preview and is not stored. The full architecture is documented here: [GITHUB SECURITY URL]
```
