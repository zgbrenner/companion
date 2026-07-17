// Options page: switches persist to cuc:settings; legacy showNativeLimits
// migration hides the popup's limit rows.
import { launchExtension, openPage, assert } from "./lib.mjs";

const { context, extensionId } = await launchExtension();
try {
  const { page, errors } = await openPage(context, extensionId, "options.html");

  const settingKeys = await page.$$eval(".switch[data-setting]", els =>
    els.map(el => el.dataset.setting)
  );
  assert(settingKeys.length >= 6, `expected ≥6 switches, found ${settingKeys.length}`);

  // Toggle every switch once and confirm each write lands in storage.
  for (const key of settingKeys) {
    const before = await page.$eval(
      `.switch[data-setting="${key}"]`,
      el => el.getAttribute("aria-checked") === "true"
    );
    await page.click(`.switch[data-setting="${key}"]`);
    await page.waitForTimeout(150);
    const stored = await page.evaluate(async k => {
      const data = await chrome.storage.local.get(["cuc:settings"]);
      return (data["cuc:settings"] || {})[k];
    }, key);
    assert(stored === !before, `${key}: expected ${!before} in storage, got ${stored}`);
  }

  // Persistence across reload.
  await page.reload();
  await page.waitForTimeout(600);
  assert(errors.length === 0, `options errors: ${errors.join(" | ")}`);
  await page.close();

  // Legacy migration: showNativeLimits:false must hide the popup limit rows.
  const { page: popup } = await openPage(context, extensionId, "popup.html");
  await popup.evaluate(() =>
    chrome.storage.local.set({ "cuc:settings": { showNativeLimits: false } })
  );
  await popup.reload();
  await popup.waitForTimeout(600);
  const nativeHidden = await popup.$eval(
    "#native-section",
    el => getComputedStyle(el).display === "none"
  );
  assert(nativeHidden, "legacy showNativeLimits:false should hide the native section");
  await popup.close();

  console.log("02-settings PASS");
} finally {
  await context.close();
}
