// Cross-platform adapter contract: provider/surface detection and safe OpenAI
// usage normalization. This test intentionally lands before src/platform.js
// so CI proves the new behavior is absent before implementation.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import vm from "node:vm";
import { EXT_PATH, assert } from "./lib.mjs";

const source = readFileSync(join(EXT_PATH, "src", "platform.js"), "utf8");
const context = vm.createContext({
  URL,
  Date,
  Math,
  Object,
  Array,
  Number,
  String,
  RegExp,
  console,
  globalThis: {},
});
vm.runInContext(source, context, { filename: "src/platform.js" });
const P = context.globalThis.CompanionPlatform;

assert(P && typeof P === "object", "CompanionPlatform global is exported");
assert(P.detectProvider("https://claude.ai/chat/abc") === "claude", "detects Claude");
assert(P.detectProvider("https://chatgpt.com/c/abc") === "openai", "detects ChatGPT");
assert(P.detectProvider("https://example.com/chatgpt.com") === null, "rejects lookalike hosts");

assert(P.detectSurface({ url: "https://chatgpt.com/c/abc" }) === "chat", "defaults ChatGPT to Chat");
assert(P.detectSurface({ url: "https://chatgpt.com/?mode=work" }) === "work", "detects Work from URL state");
assert(P.detectSurface({ url: "https://chatgpt.com/c/abc", selectedModeText: "Work" }) === "work", "detects selected Work toggle");
assert(P.detectSurface({ url: "https://chatgpt.com/codex/tasks/abc" }) === "codex", "detects Codex route");
assert(P.detectSurface({ url: "https://claude.ai/chat/abc" }) === "claude", "keeps Claude surface distinct");

assert(P.conversationIdFromUrl("https://chatgpt.com/c/67f4d38d-1234-5678-9abc-001122334455") === "67f4d38d-1234-5678-9abc-001122334455", "extracts ChatGPT conversation id");
assert(P.conversationIdFromUrl("https://chatgpt.com/") === null, "new Chat has no invented persistent id");

const reset = new Date(Date.now() + 60 * 60 * 1000).toISOString();
const normalized = P.normalizeOpenAIUsage({
  agentic_usage: {
    used_credits: 27.5,
    credit_limit: 100,
    resets_at: reset,
  },
  limits: {
    five_hour: {
      utilization: 0.62,
      reset_at: reset,
    },
  },
  token_usage: {
    input_tokens: 1234,
    output_tokens: 456,
  },
});

assert(normalized?.provider === "openai", "normalizer identifies OpenAI data");
assert(normalized.buckets.some(b => b.key === "agentic" && Math.abs(b.pct - 27.5) < 0.001), "normalizes agentic credit pool");
assert(normalized.buckets.some(b => b.key === "five-hour" && Math.abs(b.pct - 62) < 0.001), "normalizes fractional rolling utilization");
assert(normalized.counters.credits?.used === 27.5 && normalized.counters.credits?.limit === 100, "keeps exact credit counter");
assert(normalized.counters.tokens?.input === 1234 && normalized.counters.tokens?.output === 456, "keeps exact token counters");
assert(P.normalizeOpenAIUsage({ profile: { name: "Ada", plan: "Pro" } }) === null, "ignores unrelated account payloads");

console.log("06-platforms PASS");
