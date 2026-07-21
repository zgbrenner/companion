// OpenAI MAIN-world bridge contract: only first-party traffic is inspected,
// secret per-page event channels are used, and only bounded normalized numeric
// data crosses the DOM event bus. The platform normalizer itself is covered by
// 06-platforms; this test isolates transport and privacy behavior.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import vm from "node:vm";
import { EXT_PATH, assert } from "./lib.mjs";

class MiniCustomEvent extends Event {
  constructor(type, init = {}) {
    super(type);
    this.detail = init.detail;
  }
}

class FakeXHR extends EventTarget {
  static DONE = 4;
  readyState = 0;
  responseType = "";
  responseText = "";
  status = 200;
  open(method, url) { this.__method = method; this.__url = url; }
  send() {}
  getResponseHeader() { return "application/json"; }
}

async function waitFor(predicate, message, timeoutMs = 1000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  throw new Error(`ASSERT FAILED: ${message}`);
}

const windowTarget = new EventTarget();
const reset = new Date(Date.now() + 3600e3).toISOString();
windowTarget.fetch = async (input, init = {}) => {
  const url = typeof input === "string" ? input : input.url;
  if (String(url).includes("evil.example")) {
    return new Response(JSON.stringify({ agentic_usage: { used_credits: 99, credit_limit: 100 } }), {
      headers: { "content-type": "application/json" },
    });
  }
  if (String(url).includes("conversation")) {
    return new Response("data: {\"type\":\"done\"}\n\n", {
      headers: { "content-type": "text/event-stream" },
    });
  }
  return new Response(JSON.stringify({
    profile: { name: "Ada Lovelace", email: "ada@example.com" },
    agentic_usage: { used_credits: 40, credit_limit: 100, resets_at: reset },
  }), { headers: { "content-type": "application/json", "content-length": "180" } });
};

const context = vm.createContext({
  window: windowTarget,
  location: new URL("https://chatgpt.com/c/test-conversation"),
  URL,
  Event,
  EventTarget,
  CustomEvent: MiniCustomEvent,
  Response,
  Request,
  Headers,
  TextDecoder,
  XMLHttpRequest: FakeXHR,
  setTimeout,
  clearTimeout,
  Date,
  Math,
  Object,
  Array,
  Number,
  String,
  RegExp,
  JSON,
  console,
});
windowTarget.window = windowTarget;
windowTarget.location = context.location;
windowTarget.CustomEvent = MiniCustomEvent;

const platform = readFileSync(join(EXT_PATH, "src", "platform.js"), "utf8");
const injected = readFileSync(join(EXT_PATH, "src", "openai-injected.js"), "utf8");
vm.runInContext(platform, context, { filename: "src/platform.js" });
context.CompanionPlatform = {
  normalizeOpenAIUsage(payload, { sourcePath, observedAt }) {
    const credits = payload?.agentic_usage;
    if (!credits || !Number.isFinite(credits.used_credits) || !Number.isFinite(credits.credit_limit)) return null;
    return {
      provider: "openai",
      observedAt,
      sourcePath,
      maxUtilizationPct: (credits.used_credits / credits.credit_limit) * 100,
      buckets: [{
        key: "agentic",
        label: "Agentic usage",
        pct: (credits.used_credits / credits.credit_limit) * 100,
        resetsAt: credits.resets_at || null,
        used: credits.used_credits,
        limit: credits.credit_limit,
        unit: "credits",
      }],
      counters: {},
    };
  },
};

const channelId = "unit-test-channel-123456";
const usageEventName = `cuc:openai-usage:${channelId}`;
const networkEventName = `cuc:openai-network:${channelId}`;
const usageEvents = [];
const networkEvents = [];
const publicUsageEvents = [];
const publicNetworkEvents = [];
const readyEvents = [];
windowTarget.addEventListener(usageEventName, event => usageEvents.push(event.detail));
windowTarget.addEventListener(networkEventName, event => networkEvents.push(event.detail));
windowTarget.addEventListener("cuc:openai-usage-snapshot", event => publicUsageEvents.push(event.detail));
windowTarget.addEventListener("cuc:openai-network-event", event => publicNetworkEvents.push(event.detail));
windowTarget.addEventListener("cuc:openai-channel-ready", event => readyEvents.push(event));
vm.runInContext(injected, context, { filename: "src/openai-injected.js" });
windowTarget.dispatchEvent(new MiniCustomEvent("cuc:openai-channel-offer", { detail: { channelId } }));
assert(readyEvents.length === 1, "MAIN-world observer acknowledges the offered secret channel");

await windowTarget.fetch("https://chatgpt.com/backend-api/usage?access_token=secret-value&conversation=private-id");
await waitFor(() => usageEvents.length === 1, `expected one secret-channel usage event, got ${usageEvents.length}`);
assert(publicUsageEvents.length === 0, "fixed public usage event name is never used");
assert(!Object.hasOwn(usageEvents[0], "token") && !Object.hasOwn(usageEvents[0], "channelId"), "secret values are not repeated in emitted payloads");
assert(usageEvents[0].snapshot?.buckets?.[0]?.key === "agentic", "usage event contains normalized agentic bucket");
assert(usageEvents[0].snapshot?.sourcePath === "/backend-api/usage", "source path excludes query strings and their sensitive values");
const serialized = JSON.stringify(usageEvents[0]);
assert(!serialized.includes("Ada Lovelace"), "profile name never crosses the bridge");
assert(!serialized.includes("ada@example.com"), "profile email never crosses the bridge");
assert(!serialized.includes("secret-value"), "query-string secrets never cross the bridge");

await windowTarget.fetch("https://evil.example/backend-api/usage");
await new Promise(resolve => setTimeout(resolve, 20));
assert(usageEvents.length === 1, "third-party lookalike traffic is ignored");

await windowTarget.fetch("https://chatgpt.com/backend-api/conversation", { method: "POST" });
await waitFor(() => networkEvents.some(event => event.kind === "generation-complete"), "generation completion is emitted without reading conversation text");
assert(publicNetworkEvents.length === 0, "fixed public network event name is never used");

console.log("08-openai-network PASS");
