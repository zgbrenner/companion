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

  function surfaceForUrl(value) {
    try {
      const url = new URL(String(value || ""));
      const host = url.hostname.toLowerCase();
      if (url.protocol !== "https:" || !(host === "chatgpt.com" || host.endsWith(".chatgpt.com") || host === "chat.openai.com")) return null;
      const mode = ["mode", "surface", "view"]
        .map(key => url.searchParams.get(key))
        .find(Boolean)?.toLowerCase();
      const path = url.pathname.toLowerCase();
      if (mode === "work" || /(^|\/)work(?:\/|$)/.test(path)) return "work";
      if (mode === "codex" || /(^|\/)codex(?:\/|$)/.test(path)) return "codex";
      return "chat";
    } catch {
      return null;
    }
  }

  function targetUrlFor(value) {
    const target = targetForUrl(value);
    if (target !== "openai-popup.html") return target;
    const surface = surfaceForUrl(value);
    return surface ? `${target}?surface=${encodeURIComponent(surface)}` : target;
  }

  globalThis.CompanionPopupRouter = Object.freeze({ targetForUrl, surfaceForUrl, targetUrlFor });

  (async () => {
    let activeUrl = "";
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      activeUrl = tab?.url || "";
    } catch {
      // Browser-internal pages may hide their URL from extensions.
    }
    location.replace(chrome.runtime.getURL(`src/${targetUrlFor(activeUrl)}`));
  })();
})();
