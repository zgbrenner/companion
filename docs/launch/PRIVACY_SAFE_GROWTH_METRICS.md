# Privacy-Safe Growth Metrics for COMPANION

## Principle

COMPANION should become popular because it is useful, trustworthy, understandable, and well supported, not because the extension monitors users.

No product analytics, telemetry SDK, tracking pixel, remote event collector, device identifier, fingerprint, or developer backend should be added for growth measurement.

Use aggregated data already provided by the Chrome Web Store, GitHub, Product Hunt, and other publishing platforms, plus voluntary user feedback.

## Measurement boundaries

### Allowed sources

- Chrome Web Store publisher statistics
- Chrome Web Store ratings and reviews
- Chrome Web Store support questions
- GitHub stars, forks, issues, pull requests, discussions, and release downloads after the repository is public
- Product Hunt visits, comments, and platform-provided launch statistics
- Hacker News and Reddit comments visible on the public post
- Voluntary survey or interview responses that clearly state how the information will be used
- Manually recorded support categories with no prompt, reply, file, cookie, token, or private account data

### Not allowed

- analytics code inside the extension
- remote logging from the extension
- tracking pixels in extension UI or documentation
- hidden unique identifiers
- browser fingerprinting
- collection of provider account identifiers for marketing
- storage or transmission of prompts, replies, or file contents
- third-party session-replay or behavioral analytics
- scraping private community membership or direct-message lists
- linking reviews or incentives to user identity

## Funnel model

Because COMPANION has no in-product telemetry, use a privacy-preserving funnel built from aggregate distribution data and qualitative evidence.

### 1. Discovery

Measures whether the right people encounter the product.

| Metric | Source | Cadence |
| --- | --- | --- |
| Chrome Web Store listing impressions | Chrome Web Store | Daily during launch, weekly afterward |
| Store listing visits | Chrome Web Store | Daily during launch, weekly afterward |
| Product Hunt visits and comments | Product Hunt | Launch day and day 7 |
| GitHub repository views and unique visitors, if available | GitHub traffic | Weekly |
| GitHub stars | GitHub | Daily during launch, weekly afterward |
| Public launch-post views and discussion | Publishing platform | At 24 hours and day 7 |

Interpretation:

- High impressions with low listing visits suggests weak icon, title, summary, or audience fit.
- Strong listing visits with low installs suggests weak screenshots, unclear permissions, missing trust, or an install problem.
- Strong public discussion with low qualified listing visits suggests the story is interesting but the product value is unclear.

### 2. Acquisition

Measures whether an informed visitor chooses to install.

| Metric | Source | Calculation |
| --- | --- | --- |
| New installs | Chrome Web Store | Platform-reported count |
| Listing-to-install conversion | Chrome Web Store | New installs divided by listing visits when both are available |
| Install velocity | Chrome Web Store | New installs by day |
| Source release downloads | GitHub Releases | Package downloads, if public distribution is offered |

Do not set a public conversion claim before the store has a meaningful baseline. Establish the first 14-day baseline, then compare listing changes against it.

### 3. Activation proxies

COMPANION cannot observe private in-product activation without adding telemetry. Use respectful proxies instead.

| Proxy | Evidence |
| --- | --- |
| Successful first use | Voluntary tester reports and support messages |
| Widget mounted correctly | Absence and frequency of mount-related issues by provider and browser version |
| User understood native-data boundaries | Questions and confusion themes in reviews, issues, and launch comments |
| Lifejacket Mode understood | Voluntary feedback and feature-specific issue volume |
| File conversion works | Conversion bug reports by format and browser |
| Privacy model understood | Frequency of repeated permission or data-handling questions |

Run five to ten short, voluntary first-use interviews during the initial release. Record only the answer themes and explicit quotes the participant permits you to use.

### 4. Retention and product health

| Metric | Source | Interpretation |
| --- | --- | --- |
| Weekly users | Chrome Web Store | Core retention signal available without product telemetry |
| Install trend compared with weekly users | Chrome Web Store | Growing gap may indicate churn or one-time curiosity |
| Uninstall trend, if provided | Chrome Web Store | Sudden changes indicate reliability, trust, or expectation problems |
| Repeat support from the same bug class | GitHub and store support | Indicates unresolved product-health problem |
| Provider-regression frequency | GitHub issue labels | Measures maintenance burden and layout fragility |
| Update adoption, if provided | Chrome Web Store | Helps identify users stranded on older releases |

The first retention goal is not a numeric vanity target. It is a stable or improving weekly-user trend with no unexplained uninstall spike after launch or an update.

### 5. Reputation

| Metric | Source | Cadence |
| --- | --- | --- |
| Average rating | Chrome Web Store | Daily during launch, weekly afterward |
| Number of substantive reviews | Chrome Web Store | Weekly |
| Review themes | Manual classification | Weekly |
| GitHub stars and forks | GitHub | Weekly |
| Security and privacy questions resolved | GitHub/store support | Weekly |
| Public recommendations | Public posts with permission to quote | Monthly |

Classify reviews and feedback into:

- installation
- provider detection
- usage accuracy
- data availability expectations
- visual fit
- Lifejacket Mode
- file conversion
- privacy and permissions
- performance
- requested provider support

Never hide, suppress, or argue with a good-faith negative review. Respond with facts, acknowledge the issue, and link to a fix when one exists.

### 6. Organic sharing

Direct referral tracking is intentionally limited. Use public and voluntary evidence:

- people mentioning that a coworker or friend recommended COMPANION
- public links to the store or repository
- community posts created independently by users
- review language such as “recommended to my team”
- GitHub stars following educational or release posts
- voluntary answers to “How did you hear about COMPANION?” in a support or feedback form

Do not add a referral identifier to the extension or require people to identify who invited them.

## Initial operating dashboard

Create one manual weekly table. Do not publish it automatically from user data.

| Week ending | Store impressions | Listing visits | New installs | Weekly users | Rating | Reviews | GitHub stars | Open critical bugs | Main feedback theme |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| Baseline |  |  |  |  |  |  |  |  |  |

Add platform metrics only when the platform actually provides them. Leave missing fields blank rather than estimating.

## Baseline and experiment process

### First 14 days

Do not optimize aggressively during the first two weeks unless users encounter a material problem.

1. Record the baseline every day during launch week.
2. Fix broken installation, privacy mismatches, inaccurate claims, and provider regressions immediately.
3. Record repeated user questions.
4. Do not change the title, summary, screenshots, and description at the same time.
5. At day 14, identify the largest evidence-backed bottleneck.

### One-variable experiments

Good experiments:

- replace the first screenshot while holding copy constant
- clarify the short summary while holding assets constant
- move the privacy proof higher in the detailed description
- improve Quick Start instructions
- add a clearer explanation of missing OpenAI data
- publish one targeted educational article and compare the following week's aggregate listing traffic

Bad experiments:

- adding analytics to identify individual users
- changing every listing field at once
- using misleading urgency or fake scarcity
- asking unrelated communities to install for ranking purposes
- incentivizing ratings or reviews
- claiming provider endorsement

For each experiment, record:

- date
- hypothesis
- one changed variable
- previous aggregate baseline
- result after enough traffic exists
- decision to keep, revert, or run longer

## Launch-week review

### Daily questions

1. Can new users install successfully?
2. Is the product mounting on current Claude and ChatGPT layouts?
3. Are users confusing an honest empty state with a broken feature?
4. Are any public privacy or permission statements inaccurate?
5. Is one support issue repeating?
6. Did ratings or uninstalls change immediately after a release?

### Day 7 questions

1. Which channel produced the most substantive users or feedback?
2. Which screenshot or sentence do users repeat when describing the product?
3. What is the largest expectation mismatch?
4. Which provider or plan has the most integration failures?
5. Which feature creates the clearest recommendation story?
6. What should be fixed before additional promotion?

## Privacy-safe feedback methods

### GitHub issue templates

Ask only for:

- provider and surface
- browser and version
- extension version
- light or dark theme
- URL pathname without query strings
- expected behavior
- actual behavior
- sanitized screenshot with conversation and account content removed

Explicitly tell users not to share cookies, tokens, account IDs, raw private responses, prompts, replies, or confidential files.

### Optional feedback form

A public form may be used only if:

- submission is voluntary
- the form states who receives the responses
- it requests no provider credentials or private content
- it does not embed tracking into the extension
- it provides a deletion contact
- it is linked from documentation, not silently invoked by the extension

### Interviews

For voluntary interviews:

- obtain permission before recording
- store only the minimum notes needed
- ask permission before publishing a quote
- remove notes that are no longer needed

## Review collection

A review request is appropriate only after a user has experienced value.

Good approach:

- reply to a user who says COMPANION helped
- thank them
- provide the direct Chrome Web Store review page
- ask for an honest account of what worked and what did not

Do not:

- prescribe a rating
- offer features, money, access, or recognition for a review
- prevent unhappy users from reaching the review page
- repeatedly interrupt the user inside the extension
- identify or track who submitted a review

## Decision rules

### Continue promotion when

- the release package and listing remain accurate
- installation and mount failures are rare and understood
- weekly users are stable or rising
- support response is timely
- no privacy or security issue is open

### Slow promotion when

- one provider layout is failing for a meaningful group
- users repeatedly misunderstand OpenAI data availability
- support volume exceeds the ability to respond well
- the store listing and shipped permissions differ

### Pause promotion when

- private content is unexpectedly stored or transmitted
- the approved package differs from the tested package
- Clear all local data is incomplete
- the extension modifies provider data
- a material disclosure is false
- a security vulnerability could expose provider sessions or user content

## Monthly summary

At the end of each month, write a short internal summary:

- aggregate discovery and install trend
- weekly-user trend
- rating and review themes
- top three support issues
- provider regression count
- features most often praised
- main expectation mismatch
- experiments run and decisions
- privacy or security incidents, including zero if none
- next month's one or two priorities

Keep this summary aggregate. Do not include private prompts, files, account data, or identifying support details.
