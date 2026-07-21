// OpenAI MAIN-world bridge contract: only first-party traffic is inspected and
// only bounded normalized numeric data crosses the authenticated DOM event bus.
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

const usageEvents = [];
const networkEvents = [];
windowTarget.addEventListener("cuc:openai-usage-snapshot", event => usageEvents.push(event.detail));
windowTarget.addEventListener("cuc:openai-network-event", event => networkEvents.push(event.detail));
vm.runInContext(injected, context, { filename: "src/openai-injected.js" });
windowTarget.dispatchEvent(new MiniCustomEvent("cuc:openai-token-offer", { detail: { token: "unit-test-token" } }));

await windowTarget.fetch("https://chatgpt.com/backend-api/usage");
await new Promise(resolve => setTimeout(resolve, 25));
assert(usageEvents.length === 1, `expected one usage event, got ${usageEvents.length}`);
assert(usageEvents[0].token === "unit-test-token", "usage event carries the authenticated token");
assert(usageEvents[0].snapshot?.buckets?.[0]?.key === "agentic", "usage event contains normalized agentic bucket");
const serialized = JSON.stringify(usageEvents[0]);
assert(!serialized.includes("Ada Lovelace"), "profile name never crosses the bridge");
assert(!serialized.includes("ada@example.com"), "profile email never crosses the bridge");

await windowTarget.fetch("https://evil.example/backend-api/usage");
await new Promise(resolve => setTimeout(resolve, 10));
assert(usageEvents.length === 1, "third-party lookalike traffic is ignored");

await windowTarget.fetch("https://chatgpt.com/backend-api/conversation", { method: "POST" });
await new Promise(resolve => setTimeout(resolve, 25));
assert(networkEvents.some(event => event.kind === "generation-complete"), "generation completion is emitted without reading conversation text");

console.log("08-openai-network PASS");
