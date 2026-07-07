const CUC = globalThis.ClaudeUsageCompanion;
const CUCNative = globalThis.ClaudeUsageCompanionNative;
const STORAGE_KEY = CUC.makeStorageKey();

async function getActiveClaudeTab() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  const tab = tabs[0];
  try {
    const url = new URL(tab?.url || "");
    if (url.protocol === "https:" && (url.hostname === "claude.ai" || url.hostname.endsWith(".claude.ai"))) return tab;
  } catch {
    // Fall through to any Claude tab.
  }
  const claudeTabs = await chrome.tabs.query({ url: ["https://claude.ai/*", "https://*.claude.ai/*"] });
  return claudeTabs[0] || null;
}

async function loadState() {
  const stored = await chrome.storage.local.get([
    STORAGE_KEY,
    "cuc:settings",
    "cuc:native-usage",
    "cuc:native-usage-error"
  ]);
  return {
    usage: CUC.normalizeUsage(stored[STORAGE_KEY]),
    settings: { ...CUC.DEFAULT_SETTINGS, ...(stored["cuc:settings"] || {}) },
    nativeUsage: stored["cuc:native-usage"] || null,
    nativeUsageError: stored["cuc:native-usage-error"] || null
  };
}

const MAX_CONTEXT_WINDOW_TOKENS = 200_000;

function render(usage, settings, conversationId = null) {
  const conversation = CUC.getConversationUsage(usage, conversationId || undefined);
  const chatTokens = (conversation.inputTokens || 0) + (conversation.outputTokens || 0);
  const chatPct = CUC.clamp((chatTokens / MAX_CONTEXT_WINDOW_TOKENS) * 100, 0, 100);
  const spend = conversation.estimatedUsd || 0;

  const costText = CUC.formatUsd(spend);
  const tokensText = `${CUC.formatTokens(chatTokens)} tokens`;
  let chatValue = costText;
  let chatDetail = `${tokensText} · ballpark estimate`;
  if (settings.displayMode === "tokens") {
    chatValue = tokensText;
    chatDetail = `${costText} · ballpark estimate`;
  } else if (settings.displayMode === "both") {
    chatValue = `${costText} · ${tokensText}`;
    chatDetail = "Ballpark estimate for this chat";
  }

  document.getElementById("chat-value").textContent = chatValue;
  document.getElementById("chat-detail").textContent = chatDetail;
  document.getElementById("chat-bar").style.width = `${chatPct}%`;
  document.getElementById("chat-bar").className = nativeBarLevel(chatPct);
}

function nativeBarLevel(pct) {
  if (pct >= 90) return "high";
  if (pct >= 70) return "medium";
  return "low";
}

function renderNative(nativeUsage, nativeUsageError, settings) {
  const section = document.getElementById("native-section");
  if (!settings.showNativeLimits) {
    section.style.display = "none";
    return;
  }
  section.style.display = "block";

  const note = document.getElementById("native-note");
  const value = document.getElementById("enterprise-value");
  const bar = document.getElementById("enterprise-bar");
  if (nativeUsageError === "not-logged-in") {
    note.textContent = "Sign in to claude.ai to see native limits.";
    value.textContent = "—";
    bar.style.width = "0%";
    return;
  } else if (nativeUsageError) {
    note.textContent = "Native limits unavailable right now.";
    value.textContent = "—";
    bar.style.width = "0%";
    return;
  } else if (!nativeUsage) {
    note.textContent = "Open a claude.ai tab to load native limits.";
    value.textContent = "—";
    bar.style.width = "0%";
    return;
  } else {
    note.textContent = "";
  }

  const spendLimit = nativeUsage?.monthlySpendLimit;
  if (!spendLimit) {
    value.textContent = "—";
    bar.style.width = "0%";
    note.textContent = nativeUsage?.monthlySpendLimitRejected
      ? `Claude returned ${CUC.formatUsd(nativeUsage.monthlySpendLimitRejected.foundLimitUsd)}, expected ${CUC.formatUsd(nativeUsage.monthlySpendLimitRejected.expectedLimitUsd)}.`
      : "Employee monthly spend limit unavailable right now.";
    return;
  }
  const pct = CUC.clamp(spendLimit.utilizationPct, 0, 100);
  const resetText = CUCNative?.formatResetCountdown
    ? CUCNative.formatResetCountdown(spendLimit.resetsAt)
    : null;
  value.textContent = resetText
    ? `${CUC.formatUsd(spendLimit.usedUsd)} of ${CUC.formatUsd(spendLimit.limitUsd)} · resets in ${resetText}`
    : `${CUC.formatUsd(spendLimit.usedUsd)} of ${CUC.formatUsd(spendLimit.limitUsd)}`;
  bar.style.width = `${pct}%`;
  bar.className = nativeBarLevel(pct);
  note.textContent = spendLimit.outOfCredits
    ? "Monthly usage-credit limit reached"
    : "Monthly usage-credit spend from Claude.ai";
}

async function boot() {
  const state = await loadState();
  render(state.usage, state.settings);
  renderNative(state.nativeUsage, state.nativeUsageError, state.settings);

  // Ask the content script (if a claude.ai tab is open) to refresh native
  // usage and provide the active chat id/state now. The popup page itself has
  // no claude.ai URL, so storage-only rendering cannot know which conversation
  // "this chat" means.
  const tab = await getActiveClaudeTab();
  if (tab?.id) {
    chrome.tabs.sendMessage(tab.id, { type: "cuc:get-state" })
      .then(response => {
        if (response?.usage && response?.settings) {
          state.usage = response.usage;
          state.settings = response.settings;
          render(state.usage, state.settings, response.conversationId);
          renderNative(response.nativeUsage, response.nativeUsageError, state.settings);
        }
      })
      .catch(() => {
        // No content script listening yet; storage fallback above remains visible.
      });

    chrome.tabs.sendMessage(tab.id, { type: "cuc:refresh-native-usage" })
      .then(response => {
        if (response?.nativeUsage || response?.nativeUsageError) {
          renderNative(response.nativeUsage, response.nativeUsageError, state.settings);
        }
      })
      .catch(() => {
        // No content script listening (tab not on claude.ai, or not yet loaded) — ignore.
      });
  }

  document.getElementById("settings").addEventListener("click", () => chrome.runtime.openOptionsPage());

  document.getElementById("reset").addEventListener("click", async () => {
    // Route the reset through the background single-writer. Awaiting the
    // response guarantees the write finished before we re-read storage.
    try {
      await chrome.runtime.sendMessage({ type: "cuc:reset-session", reason: "manual-popup" });
    } catch {
      // Background unreachable — fall back to a direct write.
      const current = await loadState();
      await chrome.storage.local.set({ [STORAGE_KEY]: CUC.resetSession(current.usage, "manual-popup") });
    }
    const current = await loadState();
    render(current.usage, current.settings);
  });

  document.getElementById("show-widget").addEventListener("click", async () => {
    const current = await loadState();
    await chrome.storage.local.set({ "cuc:settings": { ...current.settings, showWidget: true } });
    const activeTab = await getActiveClaudeTab();
    if (activeTab?.id) chrome.tabs.sendMessage(activeTab.id, { type: "cuc:show-widget" }).catch(() => {});
  });
}

boot();
