# COMPANION Brand System

## Direction

Direction 1, **Orbit C**, is the approved identity.

- Brand name: **COMPANION**, always set in all caps when used as the product name.
- Mark: an open circular orbit forming a clear C around a mint core and endpoint.
- Personality: balanced, trusted, private, capable, and calm.
- The identity must remain recognizable at 16 pixels without relying on fine detail.

## Palette

| Token | Value | Use |
| --- | --- | --- |
| Graphite | `#111827` | App tile, darkest surfaces, primary text |
| Slate | `#334155` | Secondary surfaces and supporting text |
| Soft white | `#F8FAFC` | Mark, light surfaces, high-contrast text |
| Mint | `#35D6A6` | Primary accent, active state, orbit core |
| Iris | `#7C6CFF` | Secondary accent, Work context |

Warning and danger colors remain semantic and must not be replaced by mint or iris.

## Typography

- **League Spartan** is reserved for the COMPANION wordmark and brand-level labels.
- **Atkinson Hyperlegible Next** is used for interface text, headings, numbers, controls, and supporting copy.
- Both fonts are bundled with the extension and loaded only from extension-local files.
- No runtime font CDN, analytics endpoint, or third-party font request is allowed.

## Product rules

- Write the brand as **COMPANION**, never title-case `Companion`, in product chrome and store-facing identity.
- Use sentence case for settings, buttons, helper text, and descriptions.
- Use the Orbit C mark rather than provider logos. Provider context is shown through restrained accent changes and labels.
- Preserve AA contrast for normal text and clear focus indicators.
- Avoid gradients in the core wordmark or icon. Depth should come from spacing, restrained shadows, and surface hierarchy.

## Implementation

The extension ships only the optimized local WOFF2 font assets, the source Orbit C SVG, and four size-specific Chrome toolbar PNGs. Development TTF sources and temporary download workflows are excluded from the production branch. The popup, settings page, Claude widget, ChatGPT widget, Work surface, and Codex-aware web surface share the same core identity while retaining restrained provider-context accents.

## Validation

Every pull request must verify the computed Atkinson and League Spartan font families, all-caps wordmark, Orbit C asset, console cleanliness, and zero serious or critical accessibility violations. Chromium screenshots of Settings, the Claude popup, and the OpenAI popup are retained as CI artifacts for visual review of spacing, hierarchy, clipping, and consistency.
