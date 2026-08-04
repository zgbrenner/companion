# COMPANION v1.3.0 Launch Playbook

## Objective

Launch COMPANION as the trusted, privacy-first efficiency layer for people who work heavily in Claude and ChatGPT.

The launch should optimize for:

1. A smooth installation and first experience
2. Accurate expectations about provider data availability
3. Trust in the privacy and security model
4. Useful feedback from real users
5. Sustainable reviews, stars, recommendations, and community discussion

The goal is not one large spike. The goal is a strong first cohort that keeps the extension installed and tells other people why.

## Core message

> **COMPANION shows native Claude and ChatGPT usage when available, helps users stretch limits with local tools, and keeps prompts, replies, files, and history private.**

Supporting principle:

> **Native numbers or nothing.**

## Non-negotiable launch rules

- Do not publish until the Chrome Web Store package is approved and installable.
- Do not claim that every ChatGPT account exposes usage data.
- Do not imply Anthropic or OpenAI affiliation.
- Do not add product telemetry, tracking pixels, remote analytics, or third-party scripts.
- Do not fabricate testimonials, ratings, usage counts, press mentions, or rankings.
- Do not coordinate voting, incentivize reviews, mass-message strangers, or post identical promotional copy across unrelated communities.
- Ask for feedback. Ask for an honest review only after someone has used the product.

## Launch architecture

The public launch has four coordinated surfaces:

1. **Chrome Web Store:** the installation and reputation surface
2. **GitHub:** the source, trust, support, and contributor surface
3. **Product Hunt and Hacker News:** the maker and early-adopter discovery surface
4. **Relevant communities and social accounts:** the targeted word-of-mouth surface

Each surface needs its own copy and role. Do not treat one generic announcement as a complete launch.

## Phase 1: Pre-submission

### Product and package

- Complete every item in `store/submission-checklist.md` through the package and smoke-test sections.
- Run `.github/workflows/release-package.yml` on the final release commit.
- Download the ZIP and checksum.
- Extract and test the exact ZIP on real Claude and ChatGPT accounts.
- Test light mode, dark mode, page refresh, in-app navigation, prompt preview, one PDF, one Office file, popup routing, local-data clearing, and badge behavior.
- Record screenshots or brief notes for every issue found.
- Fix regressions before submission, not after launch.

### Public trust surface

Before the Chrome Web Store submission requires public URLs:

- Decide whether to make the GitHub repository public.
- If public, review the entire repository for secrets, private notes, temporary artifacts, personal data, stale links, and generated files.
- Enable Issues with bug and feature templates.
- Consider enabling Discussions for questions and use cases.
- Set a concise repository description:

  `Private usage and efficiency tools for Claude, ChatGPT Chat, and ChatGPT Work.`

- Recommended GitHub topics:
  - `chrome-extension`
  - `claude`
  - `chatgpt`
  - `codex`
  - `privacy`
  - `productivity`
  - `ai-tools`
  - `manifest-v3`
  - `open-source`
  - `local-first`

- Upload `docs/launch/assets/social-card-1200x630.png` as the repository social preview.
- Confirm the privacy policy and support links work while signed out.

### Store submission

- Submit v1.3.0 with **deferred publishing** enabled.
- Use the exact listing, permission, and reviewer materials under `store/`.
- Monitor the publisher email and dashboard.
- Respond to reviewer questions with direct technical facts and file references.
- Do not broaden permissions or weaken the privacy explanation to accelerate review.

## Phase 2: Approval and trusted smoke test

After approval, do not immediately launch publicly.

1. Install the approved package from the store using the publisher account.
2. Ask two to five trusted testers who use different provider plans to install it.
3. Use at least:
   - one heavy Claude user
   - one ChatGPT user
   - one dark-mode user
   - one user who has access to ChatGPT Work, if available
4. Ask each tester to complete:
   - installation
   - one provider page refresh
   - widget discovery
   - popup open
   - Settings open
   - Caveman preview
   - one file conversion
   - Clear all local data
5. Ask three questions:
   - What did you think the extension would do before installing?
   - Where did you hesitate or get confused?
   - What would make you recommend it to someone else?
6. Fix any installation, permission, privacy, or first-run confusion before public publication.

## Phase 3: Launch preparation

### Final links

Once approval is confirmed:

- Add the Chrome Web Store URL to the README.
- Add the store URL to `docs/launch/LAUNCH_COPY.md` in place of the marked launch-link line.
- Create the `v1.3.0` GitHub release from `RELEASE_NOTES_1.3.0.md`.
- Add the release URL to Product Hunt and launch posts where appropriate.
- Confirm every link works in a signed-out browser.

### Product Hunt draft

- Use the 240×240 Orbit C thumbnail.
- Upload all three 1270×760 gallery images.
- Use the Product Hunt description and maker comment in `LAUNCH_COPY.md`.
- Schedule the launch only after the store listing is live or can be published at the planned time.
- Prefer a day when the maker can answer comments for most of the day.

### Community preparation

Build a small, relevant list. Examples:

- Claude users who previously asked about limits or usage visibility
- ChatGPT and Codex users who have discussed usage limits
- privacy-focused browser extension communities
- productivity communities where the maker already participates
- developer and knowledge-worker groups where the tool solves a real recurring problem

Do not build a scraped outreach list. Do not send the same message to unrelated groups.

## Phase 4: Launch day

All times are Pacific. Adjust based on the maker's ability to respond.

### 12:01 AM

- Product Hunt goes live if Product Hunt is part of the launch.
- Publish the prepared maker comment immediately.
- Verify the store, GitHub, screenshots, and demo links.

### 6:30 AM

- Publish the Chrome Web Store listing if deferred publishing is still active.
- Make the repository public if that is the selected strategy.
- Publish the GitHub `v1.3.0` release.
- Confirm installation from a clean browser profile.

### 7:00 AM

- Publish the Hacker News Show HN post.
- Stay available to answer technical, privacy, and implementation questions.
- Lead with what was built and why. Do not make the post sound like an advertisement.

### 8:00 AM

- Publish the primary X post or thread.
- Publish the LinkedIn post if relevant to the maker's network.
- Send the brief launch note to existing friends, collaborators, and communities where the relationship already exists.

### 9:00 AM through 5:00 PM

- Respond to every substantive Product Hunt and Hacker News comment.
- Thank people for concrete feedback, not generic praise.
- Reproduce bug reports before promising a fix.
- Add confirmed issues to GitHub.
- Share one or two useful follow-up visuals or technical explanations, not repeated promotional posts.
- Post to relevant Reddit communities only after reading each community's current self-promotion rules.

### End of day

Record:

- install and listing data available from Chrome Web Store
- GitHub stars, forks, issues, and discussions if public
- Product Hunt visits and comments
- Hacker News discussion themes
- support requests and repeated confusion
- confirmed bugs and severity

Use `PRIVACY_SAFE_GROWTH_METRICS.md` for the operating review.

## Phase 5: First seven days

### Daily

- Respond to support and privacy questions.
- Triage broken provider layouts as high priority.
- Monitor Chrome Web Store reviews and reply professionally.
- Correct inaccurate public copy immediately.
- Share one useful item, such as:
  - how native usage detection differs from token estimation
  - why OpenAI usage can be unavailable on some accounts
  - how the file sandbox works
  - how Clear all local data works
  - how COMPANION handles Claude and ChatGPT separately

### Day 2 or 3

Publish a short technical post:

**Suggested title:** `How COMPANION watches usage without collecting your chats`

Cover:

- exact host permissions
- page-world normalization
- random per-page event channel
- no developer backend
- local sandboxed file conversion
- native numbers or nothing

### Day 4 or 5

Publish a practical use-case post:

**Suggested title:** `Five ways to finish more work before an AI usage limit`

Use COMPANION as one example, but make the post useful even to someone who does not install it.

### Day 7

Publish a transparent launch recap:

- what users liked
- what confused them
- what was fixed
- what remains limited by provider data
- what comes next

Use real figures only. Do not publish private user information.

## Phase 6: Days 8 through 30

### Product improvements that support growth

Prioritize in this order:

1. Installation and page-mount reliability
2. Accuracy and stale-data handling
3. Privacy clarity
4. First-run comprehension
5. Support for provider layout changes
6. Small quality-of-life improvements
7. New features

### Content cadence

Publish one genuinely useful item per week:

- a privacy or architecture explainer
- a workflow guide for Claude or ChatGPT power users
- a comparison of native counters and token estimates
- a release update tied to a real user problem

Avoid posting the same launch announcement repeatedly.

### Reputation loop

When a user reports that COMPANION solved a real problem:

1. Thank them.
2. Ask permission before quoting them publicly.
3. After they have used the extension, provide the direct Chrome Web Store review link and ask for an honest review.
4. Never prescribe a rating or offer an incentive.

## Growth loops

### Trust loop

Transparent source and privacy documentation → confidence to install → fewer permission-related uninstalls → stronger reviews and recommendations.

### Utility loop

Accurate native usage and local efficiency tools → users avoid interruptions and reduce wasted quota → users share the extension with coworkers and friends who have the same problem.

### Feedback loop

Public issue tracker and fast responses → provider regressions are identified quickly → fixes ship faster → existing users remain confident in the product.

### Education loop

Useful technical and workflow content → people discover COMPANION while solving a problem → the listing receives better-informed visitors → installation intent and retention improve.

### Contributor loop

Readable unminified code and a clear architecture → privacy and extension developers audit or contribute → public confidence and product quality improve.

## Support standards

Recommended launch-week targets:

- acknowledge security or privacy reports within 12 hours
- acknowledge installation-breaking reports within 12 hours
- acknowledge normal bugs within one business day
- acknowledge feature requests within two business days

Do not promise a fix date before reproducing the issue.

## Rollback and pause criteria

Pause promotion or unpublish the release if any of these occurs:

- prompts, replies, raw provider payloads, or files are transmitted unexpectedly
- the release package differs from the tested package
- a provider integration repeatedly sends or modifies account data
- installation causes a major provider composer regression
- Clear all local data fails to remove stored state
- a public privacy statement is materially false
- Chrome Web Store flags a permission or disclosure mismatch that affects user safety

Publish a factual incident note and corrective release before resuming promotion.

## Manual actions that remain after release preparation

- make the repository public, if approved
- publish or host the privacy policy publicly
- submit the Chrome Web Store package
- respond to review
- publish the approved listing
- create the GitHub release and tag
- schedule Product Hunt
- publish community and social posts
- reply to users and reviews

These actions require the maker's accounts and judgment and should not be automated from the extension repository.
