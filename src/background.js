import "./shared.js";
import "./updater.js";

const CUC = globalThis.ClaudeUsageCompanion;
const UPDATER = globalThis.ClaudeUsageCompanionUpdater;

const SPEND_SESSION_KEY = "cuc:spend-session";
const SPEND_DAYS_KEY = "cuc:spend-days";

// Let content scripts use chrome.storage.session for the ephemeral cross-tab
// cache (native usage, pace samples, session spend baseline). Runs at every
// service-worker start; content scripts fall back to storage.local until this
// has taken effect.
try {
  chrome.storage.session?.setAccessLevel?.({ accessLevel: "TRUSTED_AND_UNTRUSTED_CONTEXTS" });
} catch {
  // Older Chrome without session access levels — the fallback covers it.
}

// The background service worker is the SINGLE writer of the spend baselines.
// Content scripts (one per claude.ai tab) report each fresh reading of
// Claude's monthly usage-credit counter; we fold them here one at a time so
// two tabs polling in the same instant can't each read-modify-write a stale
// copy and clobber the other's sample.
let writeChain = Promise.resolve();
function serialize(task) {
  const run = writeChain.then(task, task);
  // Keep the chain alive even if a task rejects, so one failure doesn't wedge
  // every subsequent write behind a permanently-rejected promise.
  writeChain = run.catch(() => {});
  return run;
}

async function sessionStoreGet(key) {
  try {
    const stored = await chrome.storage.session.get([key]);
    return stored[key] || null;
  } catch {
    const stored = await chrome.storage.local.get([key]);
    return stored[key] || null;
  }
}

async function sessionStoreSet(key, value) {
  try {
    await chrome.storage.session.set({ [key]: value });
  } catch {
    await chrome.storage.local.set({ [key]: value });
  }
}

// Fold one fresh reading of the monthly counter into the session baseline
// (storage.session — defines "spent this session") and the daily chain
// (storage.local — powers "today", the popup trend, and the CSV export).
async function recordSpendSample(sample) {
  const usedUsd = Number(sample?.usedUsd);
  if (!Number.isFinite(usedUsd)) return;

  const session = await sessionStoreGet(SPEND_SESSION_KEY);
  const nextSession = CUC.applySessionSpendSample(session, { usedUsd });
  if (nextSession !== session) await sessionStoreSet(SPEND_SESSION_KEY, nextSession);

  const stored = await chrome.storage.local.get([SPEND_DAYS_KEY]);
  const nextDays = CUC.applyDailySpendSample(stored[SPEND_DAYS_KEY], { usedUsd });
  await chrome.storage.local.set({ [SPEND_DAYS_KEY]: nextDays });
}

// "Restart session counter" (popup): re-baseline at the last known reading so
// the delta returns to $0.00 immediately.
async function resetSpendSession() {
  const session = await sessionStoreGet(SPEND_SESSION_KEY);
  if (!session || !Number.isFinite(session.lastUsd)) {
    // Nothing sampled yet this session — removing lets the next sample baseline.
    try {
      await chrome.storage.session.remove([SPEND_SESSION_KEY]);
    } catch {
      await chrome.storage.local.remove([SPEND_SESSION_KEY]);
    }
    return;
  }
  await sessionStoreSet(SPEND_SESSION_KEY, {
    ...session,
    baselineUsd: session.lastUsd,
    startedAt: Date.now()
  });
}

// Toolbar badge: a red/amber percentage when any of Claude's real limits is
// running hot, so people get warned even when the in-page widget is hidden.
function updateBadge(maxUtilizationPct) {
  try {
    if (typeof maxUtilizationPct === "number" && maxUtilizationPct >= 80) {
      const pct = Math.min(100, Math.round(maxUtilizationPct));
      chrome.action.setBadgeText({ text: `${pct}%` });
      chrome.action.setBadgeBackgroundColor({ color: pct >= 90 ? "#b23b3b" : "#b4791f" });
    } else {
      chrome.action.setBadgeText({ text: "" });
    }
  } catch {
    // Badge failures must never affect spend tracking.
  }
}

// Desktop notifications when a limit crosses 85% / 95% — once per threshold
// per reset window, so this nudges rather than nags. State lives in storage
// so multiple tabs reporting the same reading can't duplicate a notification;
// calls are routed through the same serialized writer as spend samples.
const NOTIFY_THRESHOLDS = [85, 95];
const NOTIFY_STATE_KEY = "cuc:notify-state";
const NOTIFY_MIN_REPEAT_MS = 6 * 60 * 60 * 1000;

function shortCountdown(resetsAt) {
  const resetMs = Date.parse(resetsAt || "");
  if (Number.isNaN(resetMs)) return null;
  const totalMinutes = Math.round((resetMs - Date.now()) / 60000);
  if (totalMinutes <= 0) return null;
  if (totalMinutes < 60) return `${totalMinutes}m`;
  const hours = Math.floor(totalMinutes / 60);
  if (hours < 24) return `${hours}h ${totalMinutes % 60}m`;
  return `${Math.floor(hours / 24)}d ${hours % 24}h`;
}

async function maybeNotifyThresholds(buckets) {
  const stored = await chrome.storage.local.get([NOTIFY_STATE_KEY, "cuc:settings"]);
  const settings = { ...CUC.DEFAULT_SETTINGS, ...(stored["cuc:settings"] || {}) };
  if (!settings.desktopNotifications) return;

  const state = stored[NOTIFY_STATE_KEY] || {};
  let changed = false;

  for (const bucket of Array.isArray(buckets) ? buckets : []) {
    if (!bucket?.key || typeof bucket.pct !== "number") continue;
    const crossed = NOTIFY_THRESHOLDS.filter(t => bucket.pct >= t);
    const top = crossed.length ? Math.max(...crossed) : 0;

    // A new reset window (different resetsAt) starts the notification slate
    // fresh; falling back below every threshold does too (covers buckets
    // whose payload carries no reset timestamp).
    const entry = state[bucket.key];
    if (!entry || entry.resetsAt !== (bucket.resetsAt || null)) {
      state[bucket.key] = { resetsAt: bucket.resetsAt || null, notified: 0, at: 0 };
      changed = true;
    }
    const record = state[bucket.key];
    if (top === 0) {
      if (record.notified !== 0) {
        record.notified = 0;
        changed = true;
      }
      continue;
    }
    if (top <= record.notified && Date.now() - (record.at || 0) < NOTIFY_MIN_REPEAT_MS) continue;
    if (top <= record.notified) continue;

    const countdown = shortCountdown(bucket.resetsAt);
    const message = countdown
      ? `${bucket.label} is at ${Math.round(bucket.pct)}%. It resets in ${countdown}.`
      : `${bucket.label} is at ${Math.round(bucket.pct)}%.`;
    try {
      chrome.notifications.create(`cuc-${bucket.key}-${top}`, {
        type: "basic",
        iconUrl: chrome.runtime.getURL("icons/icon128.png"),
        title: "Claude usage heads-up",
        message,
        priority: top >= 95 ? 2 : 1
      });
    } catch {
      // Notifications are best-effort.
    }
    record.notified = top;
    record.at = Date.now();
    changed = true;
  }

  if (changed) {
    try {
      await chrome.storage.local.set({ [NOTIFY_STATE_KEY]: state });
    } catch {
      // Losing dedupe state means at worst one repeat notification.
    }
  }
}

chrome.runtime.onInstalled.addListener(async () => {
  UPDATER?.scheduleUpdateChecks();
  const existing = await chrome.storage.local.get(["cuc:settings"]);
  if (!existing["cuc:settings"] && CUC?.DEFAULT_SETTINGS) {
    await chrome.storage.local.set({ "cuc:settings": CUC.DEFAULT_SETTINGS });
  }
  // v0.8.0 dropped the token-estimate event store; clear the orphaned blob.
  chrome.storage.local.remove(["cuc:usage"]).catch(() => {});
});

// Periodic GitHub update check. The alarm survives service-worker teardown;
// onStartup re-arms it after a browser restart just in case.
chrome.runtime.onStartup.addListener(() => UPDATER?.scheduleUpdateChecks());
chrome.alarms?.onAlarm?.addListener(alarm => {
  if (alarm?.name === UPDATER?.ALARM_NAME) {
    UPDATER.checkForUpdate().catch(() => {
      // Offline or GitHub unreachable — the next alarm retries.
    });
  }
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "cuc:open-options") {
    chrome.runtime.openOptionsPage();
    return false;
  }
  if (message?.type === "cuc:native-usage-updated") {
    updateBadge(message.maxUtilizationPct);
    serialize(() => maybeNotifyThresholds(message.buckets)).catch(() => {});
    if (message.monthlySpend) {
      serialize(() => recordSpendSample(message.monthlySpend)).catch(() => {});
    }
    return false;
  }
  if (message?.type === "cuc:reset-spend-session") {
    serialize(() => resetSpendSession()).then(
      () => sendResponse({ ok: true }),
      () => sendResponse({ ok: false })
    );
    return true; // keep the channel open for the async sendResponse
  }
  return false;
});
