# COMPANION v1.2 Release and Growth Design

## Goal

Prepare COMPANION v1.2.0 for a credible public release that can earn trust, installs, reviews, stars, and organic discussion without adding analytics, telemetry, dark patterns, or spammy promotion.

## Release story

The public story is simple:

> **COMPANION is one private efficiency layer for Claude and ChatGPT. It shows native usage numbers when providers expose them, helps users stretch limits with local tools, and keeps prompts, replies, files, and usage history on-device.**

The release combines three meaningful changes that belong together:

1. Claude, ChatGPT Chat, ChatGPT Work, and Codex-aware web support in one extension.
2. The privacy and reliability hardening required for a multi-provider extension.
3. The Orbit C identity and all-caps COMPANION brand system.

The tagline and launch copy must emphasize the product's principle, **native numbers or nothing**, rather than claiming universal access to data that a provider may not expose for every account.

## Target users

Primary users are people who spend substantial time in Claude or ChatGPT and care about avoiding an unexpected limit in the middle of work:

- developers and technical users
- students and researchers
- writers, analysts, lawyers, and other knowledge workers
- privacy-conscious users who avoid cloud telemetry
- heavy Claude users who want exact spend and limit data
- ChatGPT, Work, and Codex users who want the same local efficiency tools across surfaces

## Distribution architecture

### Chrome Web Store

Chrome Web Store is the primary installation channel. The release package must be reproducible, contain only runtime files, and be accompanied by accurate listing, privacy, permission, reviewer, and testing materials.

The recommended publishing sequence is:

1. Upload v1.2.0 and submit with deferred publishing enabled.
2. After approval, make the listing available to trusted testers or unlisted testers for a brief real-account smoke test if the dashboard setup permits it.
3. Publish publicly only after the approved package passes the smoke test.
4. Coordinate the public store link with the GitHub release and launch posts.

### GitHub

The repository is the trust and community surface. Before public launch it should have:

- an all-caps, conversion-oriented README
- clear installation and privacy explanations
- release notes and a reproducible package workflow
- contribution and security documentation
- current screenshots and launch assets
- support paths for bug reports and feature requests

Changing repository visibility, publishing a GitHub release, and setting repository topics or the social preview are launch actions, not automatic changes in this preparation pass.

### Launch channels

The launch kit will include tailored, non-duplicative copy for:

- Product Hunt
- Hacker News Show HN
- relevant Reddit communities
- X
- LinkedIn
- personal and team group chats
- direct outreach to relevant extension, Claude, ChatGPT, privacy, and productivity communities where the maker already participates

The copy must ask for feedback or invite people to try the product. It must not ask for Product Hunt upvotes, coordinate votes, mass-message strangers, or offer incentives for ratings.

## Store listing strategy

The Chrome Web Store title remains **COMPANION**. The summary should fit within 132 characters, name both Claude and ChatGPT, and lead with privacy and practical value. The detailed description should use a concise overview followed by a short feature list, accurate provider boundaries, a privacy section, and an explicit non-affiliation statement.

The listing must accurately disclose:

- exact Claude usage and spend data when exposed
- bounded native OpenAI numeric usage fields when exposed
- local prompt trimming and file-to-Markdown conversion
- local settings, history, usage snapshots, alert state, and badge ownership state
- exact Claude and ChatGPT host permissions
- `storage`, `activeTab`, `notifications`, `offscreen`, and `alarms`
- no remote code, no developer backend, no analytics, and no telemetry

## Visual assets

The release will ship a coordinated asset set built from the approved Orbit C identity and real product renders:

- 440×280 Chrome Web Store small promotional tile
- 1400×560 Chrome Web Store marquee image
- five 1280×800 Chrome Web Store screenshots
- 240×240 Product Hunt thumbnail
- three 1270×760 Product Hunt gallery images
- 1200×630 social sharing card

Promotional images will be simple and brand-led. Store screenshots will use actual popup and settings renders inside a full-bleed branded composition with concise annotations. No provider logos, fabricated awards, misleading rankings, or unsupported claims will appear.

## Release engineering

A release workflow will:

1. Run the complete numbered test suite.
2. Build the Web Store ZIP with the existing packaging script.
3. inspect the package contents
4. generate a SHA-256 checksum
5. retain the ZIP and checksum as a workflow artifact

A dedicated release-readiness test will prevent the release docs, privacy disclosures, listing assets, launch kit, or automation from silently drifting back to the previous Claude-only state.

## Privacy-safe growth system

COMPANION will not add product telemetry for launch measurement. Growth will be evaluated using data already available at distribution surfaces:

- Chrome Web Store impressions, listing visits, installs, weekly users, ratings, reviews, and uninstall trends
- GitHub stars, forks, issues, discussions, and release downloads after the repository is public
- Product Hunt visits, comments, and qualitative feedback
- launch-link click counts only when supplied by the publishing platform itself, not by tracking code added to COMPANION
- support requests and recurring themes

The first growth loop is product quality: clear onboarding, low uninstall rate, accurate claims, fast support, and respectful review requests after users have had time to experience value.

## Success criteria

The preparation pass is complete when:

- the current product, privacy policy, permission justifications, and listing copy agree with one another
- v1.2.0 has finalized release notes and a reproducible release artifact workflow
- all required and recommended launch images exist at exact dimensions
- the README and launch kit are ready to publish without rewriting
- all numbered tests pass, including release readiness and asset integrity
- the final pull request is reviewable and mergeable

## Out of scope

This pass does not:

- submit or publish the Chrome Web Store item
- change the repository from private to public
- create or schedule a Product Hunt launch
- send social posts, emails, direct messages, or community submissions
- fabricate testimonials, install counts, ratings, awards, or press coverage
- add telemetry or third-party analytics
