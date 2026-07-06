import "./shared.js";

chrome.runtime.onInstalled.addListener(async () => {
  const existing = await chrome.storage.local.get(["cuc:settings"]);
  if (!existing["cuc:settings"] && globalThis.ClaudeUsageCompanion?.DEFAULT_SETTINGS) {
    await chrome.storage.local.set({ "cuc:settings": globalThis.ClaudeUsageCompanion.DEFAULT_SETTINGS });
  }
});

chrome.runtime.onMessage.addListener((message) => {
  if (message?.type === "cuc:open-options") {
    chrome.runtime.openOptionsPage();
  }
});
