import "./shared.js";

const CUC = globalThis.ClaudeUsageCompanion;
const STORAGE_KEY = CUC.makeStorageKey();

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
  const usage = stored[STORAGE_KEY] || CUC.emptyUsage();
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

async function resetSession(reason) {
  const { usage } = await loadUsageAndSettings();
  await writeUsage(CUC.resetSession(usage, reason || "manual"));
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
  if (message?.type === "cuc:record-event" && message.event) {
    serialize(() => applyEvent(message.event)).then(
      () => sendResponse({ ok: true }),
      () => sendResponse({ ok: false })
    );
    return true; // keep the channel open for the async sendResponse
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
