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
  const stored = await chrome.storage.local.get([STORAGE_KEY, "cuc:settings"]);
  // The native-usage cache and pace samples are ephemeral cross-tab state —
  // they live in storage.session (with a local fallback), not storage.local.
  const ephemeral = await CUC.ephemeralGet(["cuc:native-usage", "cuc:native-usage-error", "cuc:pace-samples"]);
  return {
    usage: CUC.normalizeUsage(stored[STORAGE_KEY]),
    settings: { ...CUC.DEFAULT_SETTINGS, ...(stored["cuc:settings"] || {}) },
    nativeUsage: ephemeral["cuc:native-usage"] || null,
    nativeUsageError: ephemeral["cuc:native-usage-error"] || null,
    paceSamples: Array.isArray(ephemeral["cuc:pace-samples"]) ? ephemeral["cuc:pace-samples"] : []
  };
}

const MAX_CONTEXT_WINDOW_TOKENS = 200_000;

// The last conversation id a claude.ai tab told us about. The popup page's
// own URL is chrome-extension://…, so parsing it (the old behavior) labeled
// the shared "home-or-new-chat" bucket as "this chat" — wrong and confusing.
let knownConversationId = null;

function render(usage, settings) {
  renderSummary(usage);

  const chatValueEl = document.getElementById("chat-value");
  const chatDetailEl = document.getElementById("chat-detail");
  const chatBarEl = document.getElementById("chat-bar");

  if (!knownConversationId) {
    chatValueEl.textContent = "—";
    // First-run empty state: a fresh install with zero history gets a
    // friendly pointer instead of a wall of dashes and $0.00.
    const nothingTrackedYet = Object.keys(usage.days || {}).length === 0;
    chatDetailEl.textContent = nothingTrackedYet
      ? "No usage tracked yet — send Claude a message to start."
      : "Open a claude.ai tab to see this chat.";
    setBar(chatBarEl, 0);
    return;
  }

  const conversation = CUC.getConversationUsage(usage, knownConversationId);
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

  chatValueEl.textContent = chatValue;
  chatDetailEl.textContent = chatDetail;
  setBar(chatBarEl, chatPct);
}

function renderSummary(usage) {
  const today = CUC.getTodayUsage(usage);
  const month = CUC.getMonthUsage(usage);
  document.getElementById("today-value").textContent = CUC.formatUsd(today.estimatedUsd || 0);
  document.getElementById("month-value").textContent = CUC.formatUsd(month.estimatedUsd || 0);
  renderTrend(usage);
}

// 14 flexbox bars, no chart library — each day's estimated spend scaled to
// the busiest day in the window. Hidden entirely until there are at least
// two active days, so a fresh install isn't greeted by an empty chart.
function renderTrend(usage) {
  const trend = document.getElementById("trend");
  const caption = document.getElementById("trend-caption");
  if (!trend) return;
  const series = CUC.recentDaysSeries(usage, 14);
  const max = Math.max(...series.map(d => d.estimatedUsd));
  const activeDays = series.filter(d => d.estimatedUsd > 0).length;
  if (!(max > 0) || activeDays < 2) {
    trend.hidden = true;
    if (caption) caption.hidden = true;
    return;
  }
  trend.hidden = false;
  if (caption) caption.hidden = false;
  trend.textContent = "";
  const todayKey = CUC.todayKey();
  for (const day of series) {
    const bar = document.createElement("div");
    bar.className = day.date === todayKey ? "trend-bar today" : "trend-bar";
    const pct = Math.max(day.estimatedUsd > 0 ? 7 : 0, Math.round((day.estimatedUsd / max) * 100));
    bar.style.height = `${pct}%`;
    bar.title = `${day.date}: ${CUC.formatUsd(day.estimatedUsd)}`;
    trend.appendChild(bar);
  }
  trend.setAttribute(
    "aria-label",
    `Daily usage, last 14 days. Busiest day ${CUC.formatUsd(max)}. Today ${CUC.formatUsd(series[series.length - 1].estimatedUsd)}.`
  );
}

function nativeBarLevel(pct) {
  if (pct >= 90) return "high";
  if (pct >= 70) return "medium";
  return "low";
}

function setBar(bar, pct) {
  if (!bar) return;
  const clamped = CUC.clamp(pct, 0, 100);
  bar.style.width = `${clamped}%`;
  bar.className = nativeBarLevel(clamped);
  bar.parentElement?.setAttribute?.("aria-valuenow", String(Math.round(clamped)));
}

const NATIVE_BUCKETS = [
  { id: "five-hour", prop: "fiveHour" },
  { id: "seven-day", prop: "sevenDay" },
  { id: "opus", prop: "sevenDayOpus" }
];

function bucketValueText(bucket) {
  const pct = Math.round(CUC.clamp(bucket.utilizationPct, 0, 100));
  const countdown = CUCNative?.formatResetCountdown ? CUCNative.formatResetCountdown(bucket.resetsAt) : null;
  return countdown ? `${pct}% · resets in ${countdown}` : `${pct}%`;
}

function renderNative(nativeUsage, nativeUsageError, settings) {
  const section = document.getElementById("native-section");
  if (!settings.showNativeLimits) {
    section.style.display = "none";
    return;
  }
  section.style.display = "block";

  const note = document.getElementById("native-note");
  const hideAllRows = () => {
    for (const { id } of NATIVE_BUCKETS) {
      const row = document.getElementById(`row-${id}`);
      if (row) row.hidden = true;
    }
    const enterpriseRow = document.getElementById("row-enterprise");
    if (enterpriseRow) enterpriseRow.hidden = true;
  };

  if (nativeUsageError === "not-logged-in") {
    hideAllRows();
    note.textContent = "Sign in to claude.ai to see your real limits.";
    return;
  }
  if (nativeUsageError === "forbidden") {
    hideAllRows();
    note.textContent = "The configured Organization ID doesn't match this account — check Settings, or clear it to auto-detect.";
    return;
  }
  if (nativeUsageError === "rate-limited") {
    hideAllRows();
    note.textContent = "Claude is rate-limiting usage lookups; retrying with backoff.";
    return;
  }
  if (nativeUsageError) {
    hideAllRows();
    note.textContent = "Claude's limit data is unavailable right now.";
    return;
  }
  if (!nativeUsage) {
    hideAllRows();
    note.textContent = "Open a claude.ai tab to load your real limits.";
    return;
  }

  for (const { id, prop } of NATIVE_BUCKETS) {
    const row = document.getElementById(`row-${id}`);
    if (!row) continue;
    const bucket = nativeUsage[prop];
    if (!bucket || typeof bucket.utilizationPct !== "number" || (id === "opus" && bucket.utilizationPct <= 0)) {
      row.hidden = true;
      continue;
    }
    row.hidden = false;
    document.getElementById(`${id}-value`).textContent = bucketValueText(bucket);
    setBar(document.getElementById(`${id}-bar`), bucket.utilizationPct);
  }

  const enterpriseRow = document.getElementById("row-enterprise");
  const spendLimit = nativeUsage?.monthlySpendLimit;
  if (!spendLimit) {
    if (enterpriseRow) enterpriseRow.hidden = true;
    note.textContent = nativeUsage?.monthlySpendLimitRejected
      ? `Claude returned ${CUC.formatUsd(nativeUsage.monthlySpendLimitRejected.foundLimitUsd)}, expected ${CUC.formatUsd(nativeUsage.monthlySpendLimitRejected.expectedLimitUsd)} — looks like a units mismatch, not a real cap change.`
      : "Live limits from Claude.ai — not an estimate.";
    return;
  }
  if (enterpriseRow) enterpriseRow.hidden = false;
  const pct = CUC.clamp(spendLimit.utilizationPct, 0, 100);
  const resetLabel = CUCNative?.formatResetLabel ? CUCNative.formatResetLabel(spendLimit) : null;
  document.getElementById("enterprise-value").textContent = resetLabel
    ? `${CUC.formatUsd(spendLimit.usedUsd)} of ${CUC.formatUsd(spendLimit.limitUsd)} · ${resetLabel}`
    : `${CUC.formatUsd(spendLimit.usedUsd)} of ${CUC.formatUsd(spendLimit.limitUsd)}`;
  setBar(document.getElementById("enterprise-bar"), pct);
  if (spendLimit.outOfCredits) {
    note.textContent = "Monthly usage-credit limit reached";
  } else if (spendLimit.capAdvisory) {
    note.textContent = `Cap differs from expected ${CUC.formatUsd(spendLimit.capAdvisory.expectedLimitUsd)} — update Settings if this changed.`;
  } else {
    note.textContent = "Live limits from Claude.ai — not an estimate.";
  }
}

function renderPace(paceSamples, nativeUsage, settings) {
  const el = document.getElementById("pace-note");
  if (!el) return;
  if (!settings.showNativeLimits) {
    el.hidden = true;
    return;
  }
  const projection = CUC.projectDepletion(paceSamples, Date.now(), nativeUsage?.fiveHour?.resetsAt || null);
  const text = CUC.paceWarningText(projection);
  el.textContent = text || "";
  el.hidden = !text;
}

async function boot() {
  const state = await loadState();
  render(state.usage, state.settings);
  renderNative(state.nativeUsage, state.nativeUsageError, state.settings);
  renderPace(state.paceSamples, state.nativeUsage, state.settings);

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
          knownConversationId = response.conversationId || null;
          render(state.usage, state.settings);
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
      await chrome.storage.local.set({
        [STORAGE_KEY]: CUC.resetSession(current.usage, "manual-popup", { clearConversations: true })
      });
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
