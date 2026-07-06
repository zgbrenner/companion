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
needs to change — the three load-order references (`manifest.json`,
`popup.html`, `options.html`) already point at this filename.

## Remember

This is still not an exact Claude token count — no public Claude tokenizer
exists. It's a better-calibrated approximation using a different model's
tokenizer. Keep the UI labeling ("tokenizer estimate", not "exact tokens")
honest about that.

