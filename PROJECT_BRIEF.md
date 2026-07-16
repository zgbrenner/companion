# Project brief for a coding agent

Build a browser extension for nontechnical knowledge workers who use Claude.ai heavily and want to understand their approximate usage before they hit limits or accidentally burn through usage credits.

## Working name

Companion

## Product promise

Give Claude users a simple budget-style meter while they work:

- “You have used about $1.20 of Claude-equivalent work today.”
- “This chat is getting heavy because the conversation is long.”
- “Large files and long outputs are probably driving usage.”
- “Switch to a shorter answer or start a fresh chat to conserve your session.”

## Users

Primary users are nontechnical professionals:

- HR
- Marketing
- Legal
- Operations
- Finance/admin
- Consultants and analysts

They do not think in tokens. They think in budgets, time, workstreams, and whether they are about to hit a limit.

## Core UX

The extension should show a compact widget inside Claude.ai with:

1. Estimated spend
2. Estimated tokens
3. Budget progress bar
4. Plain-English explanation
5. Model estimate
6. Settings link

The user can choose:

- Dollars only
- Tokens only
- Dollars and tokens

## Important framing

Never imply the extension knows exact Claude.ai billing. Use phrases like:

- “API-equivalent estimate”
- “Approximate usage”
- “Directional estimate”
- “Estimated economic weight”

Claude.ai subscriptions have usage limits; API and usage-credit billing may use standard API pricing. This app should estimate, not certify.

## Technical direction

The extension should use three signals:

1. Composer text before sending, counted locally and discarded.
2. Network/SSE stream observations for Claude response length.
3. Local session/conversation history to estimate carried-forward context weight.

It should not store prompt text or response text.

## Privacy posture

- No backend by default.
- No analytics by default.
- No prompt or response persistence.
- Store only counts, timestamps, model estimate, cost estimate, and high-level event metadata in local extension storage.

## First milestones

### Milestone 1 — Local MVP

- Chrome/Edge MV3 extension.
- Widget inside Claude.ai.
- Dollars/tokens/both toggle.
- Local storage.
- Settings page.
- Manual reset.

### Milestone 2 — Better usage intelligence

- More reliable Claude response parsing.
- Better model detection.
- Conversation heaviness score.
- File/context warnings.
- Daily/monthly CSV export.

### Milestone 3 — Team mode

- Admin-managed budgets.
- Exportable usage summaries.
- Department presets.
- Optional local-only classification of workstream type.

## Suggested names beyond this prototype

- Usage Companion
- Claude Budget Bar
- PromptMeter
- Workload Meter
- ContextMeter
- LimitLight
- UsageLens
