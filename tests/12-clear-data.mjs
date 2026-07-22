// Data & privacy reset: clear both provider stores and the shared toolbar badge.
import { launchExtension, openPage, assert } from "./lib.mjs";

const { context, worker, extensionId } = await launchExtension();
try {
  await worker.evaluate(async () => {
    await chrome.storage.local.set({
      "cuc:settings": { showWidget: false },
      "cuc:spend-days": { days: { "2026-07-21": { startUsd: 1, endUsd: 2 } } },
      "cuc:limit-history": { days: { "2026-07-21": { fiveHour: 50 } } },
      "cuc:openai-caveman-injected": { "conversation:test": Date.now() },
      "cuc:openai-notify-state": { agentic: { notified: 95 } },
      "cuc:detected-org": { orgId: "00000000-0000-4000-8000-000000000000" },
    });
    await chrome.storage.session.set({
      "cuc:openai-usage": {
        provider: "openai",
        surface: "work",
        observedAt: Date.now(),
        buckets: [{ key: "agentic", label: "Agentic usage", pct: 95 }],
        counters: {},
      },
      "cuc:native-usage": { fiveHour: { utilizationPct: 80 } },
      "cuc:spend-session": { baselineUsd: 1, lastUsd: 2 },
    });
    await chrome.action.setBadgeText({ text: "95%" });
  });

  const { page, errors } = await openPage(context, extensionId, "options.html");
  const description = await page.locator(".danger .row-desc").innerText();
  assert(description.includes("OpenAI snapshots"), "Settings explains that OpenAI snapshots are cleared");
  assert(description.includes("Provider accounts and conversations are not touched"), "Settings explains the provider-safe boundary");

  page.once("dialog", dialog => dialog.accept());
  await page.click("#clear-all-data");
  await page.waitForFunction(() => document.getElementById("clear-data-status")?.textContent?.includes("All local COMPANION data has been cleared"));

  const result = await worker.evaluate(async () => ({
    local: await chrome.storage.local.get(null),
    session: await chrome.storage.session.get(null),
    badge: await chrome.action.getBadgeText({}),
  }));
  assert(Object.keys(result.local).length === 0, `local storage should be empty, found ${Object.keys(result.local).join(", ")}`);
  assert(Object.keys(result.session).length === 0, `session storage should be empty, found ${Object.keys(result.session).join(", ")}`);
  assert(result.badge === "", `toolbar badge should be cleared, got ${JSON.stringify(result.badge)}`);
  assert(errors.length === 0, `options reset errors: ${errors.join(" | ")}`);

  await page.close();
  console.log("12-clear-data PASS");
} finally {
  await context.close();
}
