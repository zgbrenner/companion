# The tokenizer is now active (as of 0.4.0)

`src/o200k_base.js` is now included, verified from a real `npm install gpt-tokenizer`
(version 3.4.0, per `.package-lock.json`) rather than hand-transcribed — a single
wrong byte in a BPE rank table would produce silently wrong token counts with no
error thrown, so this file should always come from an actual package install or
verified download, never a copy-paste.

The widget footer already shows which method produced a given count
("tokenizer estimate" vs. "rough estimate" if this file is ever removed).

## If this file is ever removed or needs updating

The extension keeps working either way — `estimateTokensPrecise()` in
`src/shared.js` checks for `globalThis.GPTTokenizer_o200k_base` and falls back to
the character/word heuristic automatically if it's missing or throws.

To update to a newer `gpt-tokenizer` version: get `dist/o200k_base.js` from a
fresh `npm install gpt-tokenizer`, confirm the version in its `package.json`
matches what you intended, and replace `src/o200k_base.js` with it. No other file
needs to change — the only load-order reference is in `manifest.json`.

## Load timing (as of the 0.4.x audit)

`o200k_base.js` (~2MB) is loaded as its **own** content-script entry at
`run_at: "document_idle"`, separate from `shared.js`/`native-usage.js`/`content.js`
(which load at `document_start`). This keeps the 2MB parse/compile off the page's
critical startup path. Until it finishes loading, `estimateTokensPrecise()` falls
back to the character/word heuristic automatically, then silently upgrades to the
tokenizer once `globalThis.GPTTokenizer_o200k_base` is available.

It is intentionally **not** loaded in `popup.html` / `options.html` — neither the
popup nor the options page counts tokens (they only render already-stored numbers),
so loading 2MB there would just slow them down for nothing.

## Remember

This is still not an exact Claude token count — no public Claude tokenizer
exists. It's a better-calibrated approximation using a different model's
tokenizer. Keep the UI labeling ("tokenizer estimate", not "exact tokens")
honest about that.

