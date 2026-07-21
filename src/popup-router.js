(() => {
  function targetForUrl(value) {
    try {
      const url = new URL(String(value || ""));
      const host = url.hostname.toLowerCase();
      if (url.protocol === "https:" && (host === "chatgpt.com" || host.endsWith(".chatgpt.com") || host === "chat.openai.com")) {
        return "openai-popup.html";
      }
    } catch {
      // Unknown or protected tab. The legacy popup remains a safe fallback.
    }
    return "popup.html";
  }

  globalThis.CompanionPopupRouter = Object.freeze({ targetForUrl });

  (async () => {
    let activeUrl = "";
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      activeUrl = tab?.url || "";
    } catch {
      // Browser-internal pages may hide their URL from extensions.
    }
    location.replace(chrome.runtime.getURL(`src/${targetForUrl(activeUrl)}`));
  })();
})();
