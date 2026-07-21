(() => {
  const BADGE = globalThis.CompanionBadgeState;
  const CUC = globalThis.ClaudeUsageCompanion;
  if (!BADGE) return;

  const OPENAI_EXPIRES_MS = 2 * 60 * 60_000;

  function senderUrl(sender) {
    try { return new URL(sender?.url || sender?.tab?.url || ""); }
    catch { return null; }
  }

  function trusted(sender, provider) {
    if (sender?.id !== chrome.runtime.id || !Number.isInteger(sender?.tab?.id) || sender?.frameId !== 0) return false;
    const url = senderUrl(sender);
    if (!url || url.protocol !== "https:") return false;
    const host = url.hostname.toLowerCase();
    if (provider === "claude") return host === "claude.ai" || host.endsWith(".claude.ai");
    return host === "chatgpt.com" || host.endsWith(".chatgpt.com") || host === "chat.openai.com";
  }

  function appearance(provider, pct, alwaysShow = false) {
    if (!Number.isFinite(pct)) return { text: "", color: null };
    if (pct >= 80) {
      const value = Math.min(100, Math.round(pct));
      if (provider === "openai") return { text: `${value}%`, color: value >= 90 ? "#b42318" : "#a15c00" };
      return { text: `${value}%`, color: value >= 90 ? "#b23b3b" : "#b4791f" };
    }
    if (provider === "claude" && alwaysShow) {
      const value = Math.min(100, Math.max(0, Math.round(pct)));
      return { text: `${value}%`, color: "#6b7280" };
    }
    return { text: "", color: null };
  }

  async function applyClaude(message) {
    const pct = message.maxUtilizationPct;
    if (pct != null && (!Number.isFinite(pct) || pct < 0 || pct > 1000)) return;
    const stored = await chrome.storage.local.get(["cuc:settings"]);
    const settings = CUC?.mergeSettings?.(stored["cuc:settings"]) || {};
    const display = appearance("claude", pct, Boolean(settings.alwaysShowBadge));
    await BADGE.set({ provider: "claude", observedAt: Date.now(), ...display });
  }

  async function applyOpenAI(message) {
    if (!Number.isFinite(message.observedAt) || message.observedAt < 0 || message.observedAt > Date.now() + 300_000) return;
    const pct = message.maxUtilizationPct;
    if (pct != null && (!Number.isFinite(pct) || pct < 0 || pct > 1000)) return;
    const display = appearance("openai", pct);
    await BADGE.set({
      provider: "openai",
      observedAt: message.observedAt,
      ...display,
      expiresAt: message.observedAt + OPENAI_EXPIRES_MS,
    });
  }

  chrome.runtime.onMessage.addListener((message, sender) => {
    if (!message || typeof message !== "object" || Array.isArray(message)) return false;
    if (message.type === "cuc:native-usage-updated" && trusted(sender, "claude")) {
      applyClaude(message).catch(() => {});
    }
    if (message.type === "cuc:openai-usage-updated" && trusted(sender, "openai")) {
      applyOpenAI(message).catch(() => {});
    }
    return false;
  });
})();
