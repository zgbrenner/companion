const CUC = globalThis.ClaudeUsageCompanion;
const CUCNative = globalThis.ClaudeUsageCompanionNative;

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
  const stored = await chrome.storage.local.get(["cuc:settings", "cuc:spend-days"]);
  // Native usage, pace samples, and the session spend baseline are ephemeral
  // cross-tab state — they live in storage.session (with a local fallback).
  const ephemeral = await CUC.ephemeralGet([
    "cuc:native-usage",
    "cuc:native-usage-error",
    "cuc:pace-samples",
    "cuc:spend-session"
  ]);
  return {
    settings: { ...CUC.DEFAULT_SETTINGS, ...(stored["cuc:settings"] || {}) },
    spendDays: stored["cuc:spend-days"] || null,
    spendSession: ephemeral["cuc:spend-session"] || null,
    nativeUsage: ephemeral["cuc:native-usage"] || null,
    nativeUsageError: ephemeral["cuc:native-usage-error"] || null,
    paceSamples: Array.isArray(ephemeral["cuc:pace-samples"]) ? ephemeral["cuc:pace-samples"] : []
  };
}

function spendText(spendUsd, settings) {
  const usdText = CUC.formatUsd(spendUsd);
  const rangeText = CUC.formatTokenRange(CUC.estimateTokenRangeFromSpend(spendUsd, settings.defaultModel));
  if (settings.displayMode === "tokens") return rangeText;
  if (settings.displayMode === "both") return `${usdText} · ${rangeText}`;
  return usdText;
}

function render(state) {
  const { settings, spendSession, spendDays, nativeUsage } = state;

  // Session spend — Claude's own counter since the browser session started.
  const sessionValueEl = document.getElementById("session-value");
  const sessionDetailEl = document.getElementById("session-detail");
  const sessionBarEl = document.getElementById("session-bar");
  const deltaUsd = CUC.sessionSpendDelta(spendSession);

  if (deltaUsd == null) {
    sessionValueEl.textContent = "—";
    sessionDetailEl.textContent = "Open a claude.ai tab to load your usage.";
    setBar(sessionBarEl, 0);
  } else {
    sessionValueEl.textContent = spendText(deltaUsd, settings);
    const limitUsd = nativeUsage?.monthlySpendLimit?.limitUsd;
    setBar(sessionBarEl, limitUsd > 0 ? (deltaUsd / limitUsd) * 100 : 0);
    const startedAt = spendSession?.startedAt;
    sessionDetailEl.textContent = startedAt
      ? `All your Claude activity since ${new Date(startedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })} — real spend, not an estimate.`
      : "All your Claude activity this browser session — real spend, not an estimate.";
  }

  // Today / This month — both real numbers. "This month" is hideable.
  const todayUsd = CUC.daySpendUsd(spendDays);
  document.getElementById("today-value").textContent = todayUsd == null ? "—" : CUC.formatUsd(todayUsd);
  const monthRow = document.getElementById("month-row");
  const showMonthly = settings.showMonthlyCredits !== false;
  if (monthRow) monthRow.hidden = !showMonthly;
  if (showMonthly) {
    const monthUsd = nativeUsage?.monthlySpendLimit?.usedUsd;
    document.getElementById("month-value").textContent = typeof monthUsd === "number" ? CUC.formatUsd(monthUsd) : "—";
  }

  renderTrend(spendDays);
}

// 14 flexbox bars, no chart library — each day's real spend scaled to the
// busiest day in the window. Hidden entirely until there are at least two
// active days, so a fresh install isn't greeted by an empty chart.
function renderTrend(spendDays) {
  const trend = document.getElementById("trend");
  const caption = document.getElementById("trend-caption");
  if (!trend) return;
  const series = CUC.spendDaysSeries(spendDays, 14);
  const max = Math.max(...series.map(d => d.spendUsd));
  const activeDays = series.filter(d => d.spendUsd > 0).length;
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
    const pct = Math.max(day.spendUsd > 0 ? 7 : 0, Math.round((day.spendUsd / max) * 100));
    bar.style.height = `${pct}%`;
    bar.title = `${day.date}: ${CUC.formatUsd(day.spendUsd)}`;
    trend.appendChild(bar);
  }
  trend.setAttribute(
    "aria-label",
    `Daily spend, last 14 days. Busiest day ${CUC.formatUsd(max)}. Today ${CUC.formatUsd(series[series.length - 1].spendUsd)}.`
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
  // The monthly usage-credit view is individually hideable in Settings.
  if (settings.showMonthlyCredits === false || !spendLimit) {
    if (enterpriseRow) enterpriseRow.hidden = true;
    note.textContent = "Live limits from Claude.ai — not an estimate.";
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
  let state = await loadState();
  render(state);
  renderNative(state.nativeUsage, state.nativeUsageError, state.settings);
  renderPace(state.paceSamples, state.nativeUsage, state.settings);

  // Ask the content script (if a claude.ai tab is open) to force-refresh the
  // usage counter so the popup opens on live numbers, not the last poll.
  const tab = await getActiveClaudeTab();
  if (tab?.id) {
    chrome.tabs.sendMessage(tab.id, { type: "cuc:refresh-native-usage" })
      .then(async response => {
        if (response?.nativeUsage || response?.nativeUsageError) {
          state = await loadState();
          render(state);
          renderNative(response.nativeUsage, response.nativeUsageError, state.settings);
        }
      })
      .catch(() => {
        // No content script listening (tab not on claude.ai, or not yet loaded) — ignore.
      });
  }

  document.getElementById("settings").addEventListener("click", () => chrome.runtime.openOptionsPage());

  document.getElementById("reset").addEventListener("click", async () => {
    // Route through the background single-writer; awaiting the response
    // guarantees the re-baseline finished before we re-read storage.
    try {
      await chrome.runtime.sendMessage({ type: "cuc:reset-spend-session" });
    } catch {
      // Background unreachable — leave the baseline as is.
    }
    state = await loadState();
    render(state);
  });

  document.getElementById("show-widget").addEventListener("click", async () => {
    const current = await loadState();
    await chrome.storage.local.set({ "cuc:settings": { ...current.settings, showWidget: true } });
    const activeTab = await getActiveClaudeTab();
    if (activeTab?.id) chrome.tabs.sendMessage(activeTab.id, { type: "cuc:show-widget" }).catch(() => {});
  });
}

boot();
