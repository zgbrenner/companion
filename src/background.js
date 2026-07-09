import "./shared.js";

const CUC = globalThis.ClaudeUsageCompanion;
const STORAGE_KEY = CUC.makeStorageKey();

// Let content scripts use chrome.storage.session for the ephemeral cross-tab
// cache (native usage, pace samples). Runs at every service-worker start;
// content scripts fall back to storage.local until this has taken effect.
try {
  chrome.storage.session?.setAccessLevel?.({ accessLevel: "TRUSTED_AND_UNTRUSTED_CONTEXTS" });
} catch {
  // Older Chrome without session access levels — the fallback covers it.
}

// The background service worker is the SINGLE writer of the usage aggregate.
// Content scripts (one per claude.ai tab) send delta events; we apply them here
// one at a time against the freshest stored state. Serializing through a single
// promise chain means two tabs recording usage within the same instant can't
// each read-modify-write a stale copy and clobber the other's event (the
// previous design let the later storage.onChanged overwrite an unsaved event).
let writeChain = Promise.resolve();
function serialize(task) {
  const run = writeChain.then(task, task);
  // Keep the chain alive even if a task rejects, so one failure doesn't wedge
  // every subsequent event behind a permanently-rejected promise.
  writeChain = run.catch(() => {});
  return run;
}

async function loadUsageAndSettings() {
  const stored = await chrome.storage.local.get([STORAGE_KEY, "cuc:settings"]);
  const settings = { ...CUC.DEFAULT_SETTINGS, ...(stored["cuc:settings"] || {}) };
  const usage = CUC.normalizeUsage(stored[STORAGE_KEY]);
  return { usage, settings };
}

async function writeUsage(usage) {
  usage.lastUpdatedAt = Date.now();
  try {
    await chrome.storage.local.set({ [STORAGE_KEY]: usage });
  } catch {
    // Likely QUOTA_BYTES. pruneUsage bounds growth so this should be rare, but
    // if it happens, shed the coldest history and retry once so new usage keeps
    // persisting instead of silently failing forever.
    CUC.pruneUsage(usage);
    usage.recentEvents = (usage.recentEvents || []).slice(0, 10);
    try {
      await chrome.storage.local.set({ [STORAGE_KEY]: usage });
    } catch {
      // Give up on this write; the next event will try again from fresh state.
    }
  }
}

async function applyEvent(event) {
  const { usage, settings } = await loadUsageAndSettings();
  let next = usage;
  // Fold the five-hour session reset into the same serialized path so a reset
  // and a concurrent event can't race each other across tabs either.
  if (CUC.shouldResetSession(next, settings)) {
    next = CUC.resetSession(next, "five-hour-window");
  }
  next = CUC.addUsageEvent(next, event, settings);
  await writeUsage(next);
}

async function maybeResetStaleSession() {
  const { usage, settings } = await loadUsageAndSettings();
  // Re-check against the CURRENT stored state, not a tab's stale copy, so two
  // tabs both loading a stale session don't reset twice.
  if (CUC.shouldResetSession(usage, settings)) {
    await writeUsage(CUC.resetSession(usage, "five-hour-window"));
  }
}

async function migrateConversationEvents(fromId, toId, events) {
  const { usage } = await loadUsageAndSettings();
  const next = CUC.migrateConversationEvents(usage, fromId, toId, events);
  await writeUsage(next);
}

async function resetSession(reason) {
  const { usage } = await loadUsageAndSettings();
  // A user-initiated reset (popup button) also clears per-chat estimates —
  // that's the number on screen, so the button must visibly do something.
  // Automatic five-hour rollovers keep them.
  const clearConversations = String(reason || "").startsWith("manual");
  await writeUsage(CUC.resetSession(usage, reason || "manual", { clearConversations }));
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
    // Badge failures must never affect usage tracking.
  }
}

// Desktop notifications when a limit crosses 85% / 95% — once per threshold
// per reset window, so this nudges rather than nags (the "gentle reminder"
// pattern from mindful-browsing-style extensions). State lives in storage so
// multiple tabs reporting the same reading can't duplicate a notification;
// calls are routed through the same serialized writer as usage events.
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
  const existing = await chrome.storage.local.get(["cuc:settings"]);
  if (!existing["cuc:settings"] && CUC?.DEFAULT_SETTINGS) {
    await chrome.storage.local.set({ "cuc:settings": CUC.DEFAULT_SETTINGS });
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
    return false;
  }
  if (message?.type === "cuc:record-event" && message.event) {
    serialize(() => applyEvent(message.event)).then(
      () => sendResponse({ ok: true }),
      () => sendResponse({ ok: false })
    );
    return true; // keep the channel open for the async sendResponse
  }
  if (message?.type === "cuc:migrate-conversation-events" && message.fromId && message.toId && Array.isArray(message.events)) {
    serialize(() => migrateConversationEvents(message.fromId, message.toId, message.events)).then(
      () => sendResponse({ ok: true }),
      () => sendResponse({ ok: false })
    );
    return true;
  }
  if (message?.type === "cuc:maybe-reset-session") {
    serialize(() => maybeResetStaleSession()).then(
      () => sendResponse({ ok: true }),
      () => sendResponse({ ok: false })
    );
    return true;
  }
  if (message?.type === "cuc:reset-session") {
    serialize(() => resetSession(message.reason)).then(
      () => sendResponse({ ok: true }),
      () => sendResponse({ ok: false })
    );
    return true;
  }
  return false;
});
