// OpenAI MAIN-world observer contract: only first-party traffic is inspected,
// the one-time mailbox is removed immediately, and only bounded normalized JSON
// crosses unguessable event names.
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

class FakeMutationObserver {
  constructor(callback) { this.callback = callback; }
  observe() { this.callback(); }
  disconnect() {}
}

class FakeXHR extends EventTarget {
  responseType = "";
  responseText = "";
  response = null;
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

const channelId = "unit-test-channel-123456";
let mailboxRemoved = false;
const mailbox = {
  getAttribute(name) { return name === "data-channel" ? channelId : null; },
  remove() { mailboxRemoved = true; },
};
const documentElement = {
  attributes: new Map(),
  setAttribute(name, value) { this.attributes.set(name, value); },
  getAttribute(name) { return this.attributes.get(name) || null; },
};
const fakeDocument = {
  documentElement,
  getElementById(id) {
    return id === "cuc-openai-channel-mailbox" && !mailboxRemoved ? mailbox : null;
  },
};

const windowTarget = new EventTarget();
const pageUrl = new URL("https://chatgpt.com/c/test-conversation");
const reset = new Date(Date.now() + 3600e3).toISOString();
windowTarget.fetch = async input => {
  const rawUrl = typeof input === "string" ? input : input.url;
  const parsed = new URL(rawUrl, pageUrl);
  if (parsed.hostname === "evil.example") {
    return new Response(JSON.stringify({ agentic_usage: { used_credits: 99, credit_limit: 100 } }), {
      headers: { "content-type": "application/json" },
    });
  }
  if (parsed.pathname === "/backend-api/conversation") {
    return new Response("data: {\"type\":\"done\"}\n\n", {
      headers: { "content-type": "text/event-stream" },
    });
  }
  return new Response(JSON.stringify({
    profile: { name: "Ada Lovelace", email: "ada@example.com" },
    agentic_usage: { used_credits: 40, credit_limit: 100, resets_at: reset },
    rate_limit: { primary_window: { used_percent: 4, reset_at: Math.floor((Date.now() + 7200e3) / 1000) } },
    credits: { balance: "0", unlimited: false },
  }), { headers: { "content-type": "application/json", "content-length": "180" } });
};

const usageEvents = [];
const networkEvents = [];
windowTarget.addEventListener(`cuc:openai-usage:${channelId}`, event => usageEvents.push(JSON.parse(event.detail)));
windowTarget.addEventListener(`cuc:openai-network:${channelId}`, event => networkEvents.push(JSON.parse(event.detail)));

const context = vm.createContext({
  window: windowTarget,
  document: fakeDocument,
  location: pageUrl,
  URL,
  Event,
  EventTarget,
  CustomEvent: MiniCustomEvent,
  MutationObserver: FakeMutationObserver,
  Response,
  Request,
  Headers,
  TextDecoder,
  XMLHttpRequest: FakeXHR,
  setTimeout,
  clearTimeout,
  queueMicrotask,
  Date,
  Math,
  Object,
  Array,
  Map,
  WeakMap,
  Set,
  Number,
  String,
  RegExp,
  JSON,
  console,
});
windowTarget.window = windowTarget;
windowTarget.location = pageUrl;
windowTarget.CustomEvent = MiniCustomEvent;

const observer = readFileSync(join(EXT_PATH, "src", "openai-observer.js"), "utf8");
vm.runInContext(observer, context, { filename: "src/openai-observer.js" });
assert(mailboxRemoved, "MAIN observer removes the one-time channel mailbox immediately");
assert(documentElement.getAttribute("data-companion-openai-bridge") === "ready", "observer reaches ready state");

await windowTarget.fetch("https://chatgpt.com/backend-api/usage?access_token=secret-value&conversation=private-id");
await waitFor(() => usageEvents.length === 1, "secret channel receives one usage event");
assert(usageEvents[0].snapshot?.buckets?.[0]?.key === "agentic", "usage event contains normalized agentic bucket");
assert(usageEvents[0].snapshot?.sourcePath === "/backend-api/usage", "source path excludes query strings and their sensitive values");
assert(usageEvents[0].snapshot?.buckets?.some(bucket => bucket.key === "five-hour" && bucket.resetsAt), "usage event keeps native Unix reset timestamps");
assert(usageEvents[0].snapshot?.balances?.credits?.balance === 0, "usage event keeps native credit balance without raw account data");
const serialized = JSON.stringify(usageEvents[0]);
assert(!serialized.includes("Ada Lovelace"), "profile name never crosses the bridge");
assert(!serialized.includes("ada@example.com"), "profile email never crosses the bridge");
assert(!serialized.includes("secret-value"), "query-string secrets never cross the bridge");

await windowTarget.fetch("https://evil.example/backend-api/usage");
await new Promise(resolve => setTimeout(resolve, 20));
assert(usageEvents.length === 1, "third-party lookalike traffic is ignored");

await windowTarget.fetch("https://chatgpt.com/backend-api/conversation", { method: "POST" });
await waitFor(() => networkEvents.some(event => event.kind === "generation-complete"), "generation completion is emitted without reading conversation text");

console.log("08-openai-network PASS");
