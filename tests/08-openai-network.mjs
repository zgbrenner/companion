// OpenAI MAIN-world bridge contract: only first-party traffic is inspected,
// a transferred private MessagePort carries events, and only bounded normalized
// numeric data crosses the bridge. The platform normalizer itself is covered by
// 06-platforms; this test isolates transport and privacy behavior.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { MessageChannel } from "node:worker_threads";
import vm from "node:vm";
import { EXT_PATH, assert } from "./lib.mjs";

class MiniMessageEvent extends Event {
  constructor(type, init = {}) {
    super(type);
    this.data = init.data;
    this.origin = init.origin;
    this.source = init.source;
    this.ports = init.ports || [];
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
const pageUrl = new URL("https://chatgpt.com/c/test-conversation");
windowTarget.postMessage = (data, targetOrigin, transfer = []) => {
  if (targetOrigin !== pageUrl.origin) return;
  queueMicrotask(() => {
    windowTarget.dispatchEvent(new MiniMessageEvent("message", {
      data,
      origin: pageUrl.origin,
      source: windowTarget,
      ports: transfer,
    }));
  });
};

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
  location: pageUrl,
  URL,
  Event,
  EventTarget,
  Response,
  Request,
  Headers,
  TextDecoder,
  MessageChannel,
  XMLHttpRequest: FakeXHR,
  setTimeout,
  clearTimeout,
  queueMicrotask,
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
windowTarget.location = pageUrl;

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

vm.runInContext(injected, context, { filename: "src/openai-injected.js" });
const channel = new MessageChannel();
const messages = [];
channel.port1.on("message", message => messages.push(message));
windowTarget.postMessage({ type: "cuc:openai-port-offer" }, pageUrl.origin, [channel.port2]);
await waitFor(() => messages.some(message => message.kind === "ready"), "MAIN-world observer acknowledges the private MessagePort");

await windowTarget.fetch("https://chatgpt.com/backend-api/usage?access_token=secret-value&conversation=private-id");
await waitFor(() => messages.some(message => message.kind === "usage"), "private port receives one usage event");
const usageMessage = messages.find(message => message.kind === "usage");
assert(usageMessage.detail?.snapshot?.buckets?.[0]?.key === "agentic", "usage event contains normalized agentic bucket");
assert(usageMessage.detail?.snapshot?.sourcePath === "/backend-api/usage", "source path excludes query strings and their sensitive values");
const serialized = JSON.stringify(usageMessage);
assert(!serialized.includes("Ada Lovelace"), "profile name never crosses the bridge");
assert(!serialized.includes("ada@example.com"), "profile email never crosses the bridge");
assert(!serialized.includes("secret-value"), "query-string secrets never cross the bridge");

await windowTarget.fetch("https://evil.example/backend-api/usage");
await new Promise(resolve => setTimeout(resolve, 20));
assert(messages.filter(message => message.kind === "usage").length === 1, "third-party lookalike traffic is ignored");

await windowTarget.fetch("https://chatgpt.com/backend-api/conversation", { method: "POST" });
await waitFor(
  () => messages.some(message => message.kind === "network" && message.detail?.kind === "generation-complete"),
  "generation completion is emitted without reading conversation text",
);

channel.port1.close();
console.log("08-openai-network PASS");
