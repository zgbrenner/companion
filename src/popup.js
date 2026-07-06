const CUC = globalThis.ClaudeUsageCompanion;
const CUCNative = globalThis.ClaudeUsageCompanionNative;
const STORAGE_KEY = CUC.makeStorageKey();

async function getActiveClaudeTab() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  const tab = tabs[0];
  if (tab?.url && /https:\/\/.*claude\.ai/.test(tab.url)) return tab;
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
    usage: stored[STORAGE_KEY] || CUC.emptyUsage(),
    settings: { ...CUC.DEFAULT_SETTINGS, ...(stored["cuc:settings"] || {}) },
    nativeUsage: stored["cuc:native-usage"] || null,
    nativeUsageError: stored["cuc:native-usage-error"] || null
  };
}

function render(usage, settings) {
  const totalTokens = (usage.totals?.inputTokens || 0) + (usage.totals?.outputTokens || 0);
  const progress = CUC.getBudgetProgress(usage, settings);
  const level = CUC.usageLevel(progress);
  const pct = progress.budget ? CUC.clamp((progress.value / progress.budget) * 100, 0, 100) : 0;
  const spend = usage.totals?.estimatedUsd || 0;

  const costText = CUC.formatUsd(spend);
  const tokensText = `${CUC.formatTokens(totalTokens)} tokens`;
  let mainValue = costText;
  let tokensInline = "";
  if (settings.displayMode === "tokens") {
    mainValue = tokensText;
  } else if (settings.displayMode === "both") {
    tokensInline = ` · ${tokensText}`;
  }

  document.getElementById("cost").textContent = mainValue;
  document.getElementById("tokens-inline").textContent = tokensInline;
  document.getElementById("budget-value").textContent = `${CUC.formatUsd(progress.value)} of ${CUC.formatUsd(progress.budget)} daily budget`;
  document.getElementById("bar-fill").style.width = `${pct}%`;
  document.getElementById("bar-fill").className = level;
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
  if (nativeUsageError === "not-logged-in") {
    note.textContent = "Sign in to claude.ai to see native limits.";
  } else if (nativeUsageError) {
    note.textContent = "Native limits unavailable right now.";
  } else if (!nativeUsage) {
    note.textContent = "Open a claude.ai tab to load native limits.";
  } else {
    note.textContent = "";
  }

  const renderRow = (rowId, valueId, barId, bucket) => {
    const row = document.getElementById(rowId);
    if (!bucket) {
      row.style.display = "none";
      return;
    }
    row.style.display = "block";
    const pct = CUC.clamp(bucket.utilizationPct, 0, 100);
    const resetText = CUCNative?.formatResetCountdown
      ? CUCNative.formatResetCountdown(bucket.resetsAt)
      : null;
    document.getElementById(valueId).textContent = resetText ? `${pct}% · resets in ${resetText}` : `${pct}%`;
    const bar = document.getElementById(barId);
    bar.style.width = `${pct}%`;
    bar.className = nativeBarLevel(pct);
  };

  renderRow("native-session-row", "native-session-value", "native-session-bar", nativeUsage?.fiveHour);
  renderRow("native-weekly-row", "native-weekly-value", "native-weekly-bar", nativeUsage?.sevenDay);
}

async function boot() {
  const state = await loadState();
  render(state.usage, state.settings);
  renderNative(state.nativeUsage, state.nativeUsageError, state.settings);

  // Ask the content script (if a claude.ai tab is open) to refresh native
  // usage now, rather than waiting for its next scheduled poll.
  const tab = await getActiveClaudeTab();
  if (tab?.id) {
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
    const current = await loadState();
    const reset = CUC.resetSession(current.usage, "manual-popup");
    await chrome.storage.local.set({ [STORAGE_KEY]: reset });
    render(reset, current.settings);
  });

  document.getElementById("show-widget").addEventListener("click", async () => {
    const current = await loadState();
    await chrome.storage.local.set({ "cuc:settings": { ...current.settings, showWidget: true } });
    const activeTab = await getActiveClaudeTab();
    if (activeTab?.id) chrome.tabs.sendMessage(activeTab.id, { type: "cuc:show-widget" }).catch(() => {});
  });
}

boot();
