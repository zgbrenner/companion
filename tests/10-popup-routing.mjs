// Toolbar popup routes by the active provider and the OpenAI popup renders a
// trustworthy last-observed snapshot rather than Claude-specific fields.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import vm from "node:vm";
import { launchExtension, openPage, assert, EXT_PATH } from "./lib.mjs";

const routerSource = readFileSync(join(EXT_PATH, "src", "popup-router.js"), "utf8");

async function routedTarget(activeUrl) {
  let replaced = null;
  const context = vm.createContext({
    URL,
    console,
    location: { replace(value) { replaced = value; } },
    chrome: {
      tabs: { async query() { return [{ url: activeUrl }]; } },
      runtime: { getURL(path) { return `chrome-extension://unit-test/${path}`; } },
    },
    globalThis: {},
  });
  vm.runInContext(routerSource, context, { filename: "src/popup-router.js" });
  await new Promise(resolve => setTimeout(resolve, 0));
  return replaced;
}

assert((await routedTarget("https://chatgpt.com/?mode=work"))?.endsWith("/src/openai-popup.html"), "ChatGPT routes to OpenAI popup");
assert((await routedTarget("https://claude.ai/chat/abc"))?.endsWith("/src/popup.html"), "Claude routes to legacy popup");
assert((await routedTarget("https://example.com/"))?.endsWith("/src/popup.html"), "unknown pages fall back safely to legacy popup");

const { context, worker, extensionId } = await launchExtension();
try {
  const reset = new Date(Date.now() + 3600e3).toISOString();
  await worker.evaluate(async snapshot => {
    await chrome.storage.session.set({ "cuc:openai-usage": snapshot });
  }, {
    provider: "openai",
    surface: "work",
    observedAt: Date.now(),
    sourcePath: "/backend-api/usage",
    maxUtilizationPct: 64,
    buckets: [{ key: "agentic", label: "Agentic usage", pct: 64, resetsAt: reset, used: 64, limit: 100, unit: "credits" }],
    counters: { credits: { used: 64, limit: 100, resetsAt: reset } },
  });
  const { page, errors } = await openPage(context, extensionId, "openai-popup.html");
  const text = await page.locator("body").innerText();
  assert(text.includes("Work"), "popup renders detected Work surface");
  assert(text.includes("64") && text.includes("credits"), "popup renders exact credit counter");
  assert(text.includes("OpenAI"), "popup explains the native source");
  assert(errors.length === 0, `OpenAI popup errors: ${errors.join(" | ")}`);
  await page.close();
  console.log("10-popup-routing PASS");
} finally {
  await context.close();
}
