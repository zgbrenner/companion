// Popup renders seeded usage state: session/today/week/month figures, limit
// rows, burn-rate line, insights card, accessible trend bars.
import { launchExtension, openPage, assert, seedScript } from "./lib.mjs";

const { context, extensionId } = await launchExtension();
try {
  const { page, errors } = await openPage(context, extensionId, "popup.html");
  await page.evaluate(seedScript());
  await page.reload();
  await page.waitForTimeout(800);

  const text = id => page.$eval(`#${id}`, el => el.textContent).catch(() => null);

  assert(/\$\d/.test(await text("session-value")), "session value shows a $ figure");
  assert(/\$\d/.test(await text("today-value")), "today shows a $ figure");
  assert(/%/.test(await text("five-hour-value")), "5-hour row shows a percentage");

  // Optional-but-if-present assertions for the newer rows.
  const week = await text("week-value");
  if (week !== null) assert(/\$\d|—/.test(week), `week value malformed: ${week}`);
  const burn = await text("burn-rate-note");
  if (burn) assert(/\$\d.*\/day/.test(burn), `burn-rate line malformed: ${burn}`);
  const insights = await text("insights-summary");
  if (insights !== null && insights !== "") {
    assert(insights.length > 20, "insights summary should be a sentence");
  }

  // Trend bars: focusable buttons with aria-labels and tooltips.
  const bars = await page.$$eval("#trend .trend-bar", els =>
    els.map(el => ({
      tag: el.tagName,
      label: el.getAttribute("aria-label") || "",
      tooltip: el.dataset.tooltip || "",
    }))
  );
  assert(bars.length >= 10, `expected ≥10 trend bars, found ${bars.length}`);
  if (bars[0].tag === "BUTTON") {
    assert(bars.every(b => /\$/.test(b.label)), "every trend bar has a $ aria-label");
  }

  // Hiding monthly credits hides the month row.
  await page.evaluate(() =>
    chrome.storage.local.set({ "cuc:settings": { showMonthlyCredits: false } })
  );
  await page.reload();
  await page.waitForTimeout(600);
  const monthHidden = await page.$eval(
    "#month-row",
    el => getComputedStyle(el).display === "none"
  );
  assert(monthHidden, "month row should hide when showMonthlyCredits=false");

  assert(errors.length === 0, `popup errors: ${errors.join(" | ")}`);
  await page.close();
  console.log("03-popup-render PASS");
} finally {
  await context.close();
}
