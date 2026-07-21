// OpenAI usage freshness contract shared by the in-page widget and popup.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import vm from "node:vm";
import { EXT_PATH, assert } from "./lib.mjs";

const now = Date.parse("2026-07-21T22:00:00Z");
const context = vm.createContext({ globalThis: {}, Date, Math, Number, String, Object });
const source = readFileSync(join(EXT_PATH, "src", "openai-freshness.js"), "utf8");
vm.runInContext(source, context, { filename: "src/openai-freshness.js" });
const freshness = context.globalThis.CompanionOpenAIFreshness;
assert(freshness, "freshness helper is exported");

function at(minutesAgo) {
  return now - minutesAgo * 60_000;
}

const justNow = freshness.describe(at(0.1), now);
assert(justNow.state === "fresh" && justNow.showValues, "sub-minute readings are fresh and visible");
assert(justNow.label === "Updated just now", `unexpected just-now label: ${justNow.label}`);

const recent = freshness.describe(at(7), now);
assert(recent.state === "aging" && recent.showValues, "7-minute readings remain visible but are aging");
assert(recent.label === "Updated 7m ago", `unexpected aging label: ${recent.label}`);

const stale = freshness.describe(at(20), now);
assert(stale.state === "stale" && stale.showValues && stale.warn, "20-minute readings stay visible with a warning");
assert(stale.label === "Last observed 20m ago", `unexpected stale label: ${stale.label}`);

const expired = freshness.describe(at(121), now);
assert(expired.state === "expired" && !expired.showValues && expired.warn, "readings older than two hours are hidden");
assert(expired.label === "Last observed 2h ago", `unexpected expired label: ${expired.label}`);

const missing = freshness.describe(null, now);
assert(missing.state === "missing" && !missing.showValues, "missing timestamps cannot be presented as current usage");

const future = freshness.describe(now + 10 * 60_000, now);
assert(future.state === "expired" && !future.showValues, "implausibly future timestamps fail closed");

console.log("11-openai-freshness PASS");
