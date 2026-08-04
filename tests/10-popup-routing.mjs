// Toolbar popup routes by the active provider and the OpenAI popup renders a
// trustworthy, freshness-aware snapshot rather than Claude-specific fields.
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

assert((await routedTarget("https://chatgpt.com/?mode=work"))?.includes("/src/openai-popup.html?surface=work"), "ChatGPT routes to the Work-aware OpenAI popup");
const routerContext = vm.createContext({
  URL,
  globalThis: {},
  location: { replace() {} },
  chrome: { tabs: { async query() { return []; } }, runtime: { getURL(value) { return value; } } },
});
vm.runInContext(routerSource, routerContext, { filename: "src/popup-router.js" });
assert(routerContext.globalThis.CompanionPopupRouter.surfaceForUrl("https://chatgpt.com/?mode=work") === "work", "popup router detects the active Work surface");
assert(routerContext.globalThis.CompanionPopupRouter.targetUrlFor("https://chatgpt.com/?mode=work") === "openai-popup.html?surface=work", "popup router preserves the active surface for the OpenAI popup");
assert((await routedTarget("https://claude.ai/chat/abc"))?.endsWith("/src/popup.html"), "Claude routes to legacy popup");
assert((await routedTarget("https://example.com/"))?.endsWith("/src/popup.html"), "unknown pages fall back safely to legacy popup");

const { context, worker, extensionId } = await launchExtension();
try {
  const reset = new Date(Date.now() + 3600e3).toISOString();
  const snapshot = (observedAt, used, surface = "chat") => ({
    provider: "openai",
    surface,
    observedAt,
    sourcePath: "/backend-api/usage",
    maxUtilizationPct: used,
    buckets: [{ key: "agentic", label: "Agentic usage", pct: used, resetsAt: reset, used, limit: 100, unit: "credits" }],
    counters: { credits: { used, limit: 100, resetsAt: reset } },
    balances: { credits: { balance: 0, unlimited: false } },
  });

  await worker.evaluate(async value => {
    await chrome.storage.session.set({ "cuc:openai-usage": value });
  }, snapshot(Date.now(), 64, "chat"));

  const { page, errors } = await openPage(context, extensionId, "openai-popup.html?surface=work");
  let text = await page.locator("body").innerText();
  assert(text.includes("Work"), "popup renders detected Work surface");
  assert(text.includes("64") && text.includes("credits"), "popup renders exact fresh credit counter");
  assert(text.includes("Credits balance") && text.includes("0 credits"), "popup renders native credit balance separately");
  assert(text.includes("Updated"), "popup labels the fresh observation time");
  assert(text.includes("OpenAI"), "popup explains the native source");

  await worker.evaluate(async value => {
    await chrome.storage.session.set({ "cuc:openai-usage": value });
  }, snapshot(Date.now() - 20 * 60_000, 70));
  await page.waitForFunction(() => document.getElementById("hero-title")?.textContent?.includes("may be stale"));
  text = await page.locator("body").innerText();
  assert(text.includes("70") && text.includes("credits"), "stale values remain visible with a warning");
  assert(text.includes("Last observed 20m ago"), "stale snapshot shows its age");

  await worker.evaluate(async value => {
    await chrome.storage.session.set({ "cuc:openai-usage": value });
  }, snapshot(Date.now() - 3 * 60 * 60_000, 88));
  await page.waitForFunction(() => document.getElementById("hero-title")?.textContent?.includes("needs refresh"));
  const expiredRows = await page.locator("#rows").innerText();
  assert(expiredRows.includes("fresh native usage reading"), "expired popup asks for a fresh native reading");
  assert(!expiredRows.includes("88"), "expired numeric values are hidden");

  assert(errors.length === 0, `OpenAI popup errors: ${errors.join(" | ")}`);
  await page.close();
  console.log("10-popup-routing PASS");
} finally {
  await context.close();
}
