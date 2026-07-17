// Shared helpers for the plain-node test scripts. No test framework: each
// test file is an .mjs that throws/exits non-zero on failure. Playwright is
// resolved from PLAYWRIGHT_MODULE (or plain "playwright" in CI), Chromium
// from CHROMIUM_BIN (or Playwright's own download in CI).
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

export const EXT_PATH = join(dirname(fileURLToPath(import.meta.url)), "..");

export async function launchExtension() {
  const PW = process.env.PLAYWRIGHT_MODULE || "playwright";
  const { chromium } = await import(PW);
  const profile = mkdtempSync(join(tmpdir(), "cuc-test-"));
  const options = {
    headless: true,
    args: [
      "--headless=new",
      `--disable-extensions-except=${EXT_PATH}`,
      `--load-extension=${EXT_PATH}`,
    ],
  };
  if (process.env.CHROMIUM_BIN) {
    options.executablePath = process.env.CHROMIUM_BIN;
  } else {
    // Without an explicit binary, headless:true selects Playwright's
    // "headless shell", which cannot load extensions — the service-worker
    // wait then times out. channel:"chromium" picks the full Chromium
    // build running new headless, which can. (This is the documented
    // Playwright recipe for MV3 extension testing.)
    options.channel = "chromium";
  }
  const context = await chromium.launchPersistentContext(profile, options);
  let [worker] = context.serviceWorkers();
  if (!worker) worker = await context.waitForEvent("serviceworker", { timeout: 15000 });
  // chrome.* bindings can lag the worker's appearance under CDP.
  for (let i = 0; i < 50; i += 1) {
    const ready = await worker
      .evaluate(() => typeof chrome !== "undefined" && !!chrome.storage)
      .catch(() => false);
    if (ready) break;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  const extensionId = new URL(worker.url()).host;
  return { context, worker, extensionId };
}

export async function openPage(context, extensionId, file) {
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", error => errors.push(`pageerror: ${error}`));
  page.on("console", message => {
    if (message.type() === "error") errors.push(`console: ${message.text()}`);
  });
  await page.goto(`chrome-extension://${extensionId}/src/${file}`);
  await page.waitForTimeout(600);
  return { page, errors };
}

export function assert(condition, message) {
  if (!condition) throw new Error(`ASSERT FAILED: ${message}`);
}

// 14 days of realistic spend history ending today, plus live usage state.
export function seedScript() {
  return `(async () => {
    const now = Date.now();
    const DAY = 86400e3, HOUR = 3600e3;
    const spends = [4.1, 9.8, 0, 6.2, 14.5, 11.9, 3.4, 0, 8.8, 16.2, 7.5, 5.9, 10.4, 12.3];
    const days = {};
    let base = 20;
    for (let i = 13; i >= 0; i -= 1) {
      const key = new Date(now - i * DAY).toISOString().slice(0, 10);
      const spend = spends[13 - i];
      days[key] = { startUsd: +base.toFixed(2), endUsd: +(base + spend).toFixed(2), monthKey: key.slice(0, 7) };
      base += spend;
    }
    const history = { days: {} };
    for (let i = 20; i >= 1; i -= 1) {
      const key = new Date(now - i * DAY).toISOString().slice(0, 10);
      history.days[key] = { fiveHour: 30 + (i % 5) * 10, sevenDay: 25 + (i % 7) * 5, monthly: 20 + i };
    }
    await chrome.storage.local.set({
      "cuc:spend-days": { days },
      "cuc:limit-history": history,
      "cuc:settings": {}
    });
    await chrome.storage.session.set({
      "cuc:spend-session": { baselineUsd: base - 8.41, lastUsd: base, monthKey: new Date(now).toISOString().slice(0, 7), startedAt: now - 3 * HOUR },
      "cuc:native-usage": {
        fiveHour: { utilizationPct: 42, resetsAt: new Date(now + 2 * HOUR).toISOString() },
        sevenDay: { utilizationPct: 74, resetsAt: new Date(now + 4 * DAY).toISOString() },
        sevenDayOpus: { utilizationPct: 23, resetsAt: new Date(now + 4 * DAY).toISOString() },
        monthlySpendLimit: { usedUsd: 31.91, limitUsd: 100, utilizationPct: 31.91, resetsAt: new Date(now + 15 * DAY).toISOString(), resetsAtApprox: true }
      }
    });
  })()`;
}
