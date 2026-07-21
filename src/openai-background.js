const OPENAI_USAGE_KEY = "cuc:openai-usage";
const OPENAI_CAVEMAN_KEY = "cuc:openai-caveman-injected";
const OPENAI_NOTIFY_KEY = "cuc:openai-notify-state";
const MAX_CAVEMAN_ENTRIES = 200;
const MAX_BUCKETS = 8;
const MAX_COUNTER_KEYS = 5;
const MAX_PCT = 1000;
const MAX_VALUE = 1_000_000_000;
const ALLOWED_BUCKET_KEYS = new Set(["agentic", "five-hour", "daily", "seven-day", "monthly"]);
const ALLOWED_UNITS = new Set(["credits", "usd", "tokens", "messages", null]);
const ALLOWED_SURFACES = new Set(["chat", "work", "codex"]);
const CONVERTIBLE_EXTENSIONS = new Set(["pdf", "docx", "pptx", "xlsx", "odt", "odp", "ods", "rtf", "csv", "html", "htm"]);
const MAX_CONVERT_DATAURL_CHARS = 30_000_000;
const NOTIFY_THRESHOLDS = [85, 95];
const NOTIFY_REPEAT_MS = 6 * 60 * 60 * 1000;
let openaiWriteChain = Promise.resolve();
let openaiOffscreenCreating = null;

function serializeOpenAI(task) {
  const run = openaiWriteChain.then(task, task);
  openaiWriteChain = run.catch(() => {});
  return run;
}

function isPlainRecord(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function hasOnlyKeys(record, keys) {
  return Object.keys(record).every(key => keys.has(key));
}

function senderUrl(sender) {
  try { return new URL(sender?.url || sender?.tab?.url || ""); }
  catch { return null; }
}

function isOpenAIHost(hostname) {
  const host = String(hostname || "").toLowerCase();
  return host === "chatgpt.com"
    || host.endsWith(".chatgpt.com")
    || host === "chat.openai.com";
}

function isTrustedOpenAIContentSender(sender) {
  if (sender?.id !== chrome.runtime.id) return false;
  if (!Number.isInteger(sender?.tab?.id) || sender?.frameId !== 0) return false;
  const url = senderUrl(sender);
  return Boolean(url && url.protocol === "https:" && isOpenAIHost(url.hostname));
}

function validConversationKey(value) {
  return typeof value === "string" && /^[A-Za-z0-9:_-]{8,160}$/.test(value);
}

function normalizeReset(value) {
  if (value == null) return null;
  if (typeof value !== "string" || value.length > 160) return undefined;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : undefined;
}

function normalizeCounter(value, tokenCounter = false) {
  if (!isPlainRecord(value)) return null;
  if (tokenCounter) {
    if (!hasOnlyKeys(value, new Set(["input", "output", "total"]))) return null;
    const result = {};
    for (const key of ["input", "output", "total"]) {
      if (value[key] == null) continue;
      if (!Number.isFinite(value[key]) || value[key] < 0 || value[key] > MAX_VALUE) return null;
      result[key] = value[key];
    }
    return Object.keys(result).length ? result : null;
  }

  if (!hasOnlyKeys(value, new Set(["used", "limit", "resetsAt"]))) return null;
  if (!Number.isFinite(value.used) || value.used < 0 || value.used > MAX_VALUE) return null;
  let limit = null;
  if (value.limit != null) {
    if (!Number.isFinite(value.limit) || value.limit <= 0 || value.limit > MAX_VALUE) return null;
    limit = value.limit;
  }
  const resetsAt = normalizeReset(value.resetsAt);
  if (resetsAt === undefined) return null;
  return { used: value.used, limit, resetsAt };
}

function normalizeOpenAIMessage(message) {
  if (!isPlainRecord(message)) return null;
  if (!hasOnlyKeys(message, new Set([
    "type", "surface", "observedAt", "sourcePath", "maxUtilizationPct", "buckets", "counters",
  ]))) return null;
  if (!ALLOWED_SURFACES.has(message.surface)) return null;
  if (!Number.isFinite(message.observedAt) || message.observedAt < 0 || message.observedAt > Date.now() + 300_000) return null;
  if (message.sourcePath != null && (typeof message.sourcePath !== "string" || message.sourcePath.length > 240)) return null;

  let maxUtilizationPct = null;
  if (message.maxUtilizationPct != null) {
    if (!Number.isFinite(message.maxUtilizationPct) || message.maxUtilizationPct < 0 || message.maxUtilizationPct > MAX_PCT) return null;
    maxUtilizationPct = message.maxUtilizationPct;
  }

  if (!Array.isArray(message.buckets) || message.buckets.length > MAX_BUCKETS) return null;
  const buckets = [];
  const seen = new Set();
  for (const bucket of message.buckets) {
    if (!isPlainRecord(bucket)) return null;
    if (!hasOnlyKeys(bucket, new Set(["key", "label", "pct", "resetsAt", "used", "limit", "unit"]))) return null;
    if (!ALLOWED_BUCKET_KEYS.has(bucket.key) || seen.has(bucket.key)) return null;
    if (typeof bucket.label !== "string" || bucket.label.length < 1 || bucket.label.length > 80) return null;
    if (!Number.isFinite(bucket.pct) || bucket.pct < 0 || bucket.pct > MAX_PCT) return null;
    const resetsAt = normalizeReset(bucket.resetsAt);
    if (resetsAt === undefined) return null;
    const unit = bucket.unit ?? null;
    if (!ALLOWED_UNITS.has(unit)) return null;
    for (const number of [bucket.used, bucket.limit]) {
      if (number != null && (!Number.isFinite(number) || number < 0 || number > MAX_VALUE)) return null;
    }
    if (bucket.limit != null && bucket.limit <= 0) return null;
    seen.add(bucket.key);
    buckets.push({
      key: bucket.key,
      label: bucket.label,
      pct: bucket.pct,
      resetsAt,
      used: bucket.used ?? null,
      limit: bucket.limit ?? null,
      unit,
    });
  }

  if (!isPlainRecord(message.counters) || Object.keys(message.counters).length > MAX_COUNTER_KEYS) return null;
  const counters = {};
  for (const [key, value] of Object.entries(message.counters)) {
    if (!["credits", "usd", "messages", "tokens"].includes(key)) return null;
    const normalized = normalizeCounter(value, key === "tokens");
    if (!normalized) return null;
    counters[key] = normalized;
  }

  return {
    provider: "openai",
    surface: message.surface,
    observedAt: message.observedAt,
    sourcePath: message.sourcePath || null,
    maxUtilizationPct,
    buckets,
    counters,
  };
}

async function storeOpenAIUsage(snapshot) {
  await chrome.storage.session.set({ [OPENAI_USAGE_KEY]: snapshot }).catch(async () => {
    await chrome.storage.local.set({ [OPENAI_USAGE_KEY]: snapshot });
  });
}

function applyOpenAIBadge(maxPct) {
  try {
    if (!Number.isFinite(maxPct) || maxPct < 80) return;
    const pct = Math.min(100, Math.round(maxPct));
    chrome.action.setBadgeText({ text: `${pct}%` });
    chrome.action.setBadgeBackgroundColor({ color: pct >= 90 ? "#b42318" : "#a15c00" });
  } catch {
    // Badge display is best effort.
  }
}

function countdown(resetsAt) {
  const reset = Date.parse(resetsAt || "");
  if (!Number.isFinite(reset)) return null;
  const minutes = Math.round((reset - Date.now()) / 60_000);
  if (minutes <= 0) return null;
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ${minutes % 60}m`;
  return `${Math.floor(hours / 24)}d ${hours % 24}h`;
}

async function maybeNotifyOpenAI(snapshot) {
  const settingsStored = await chrome.storage.local.get(["cuc:settings", OPENAI_NOTIFY_KEY]);
  const settings = globalThis.ClaudeUsageCompanion?.mergeSettings?.(settingsStored["cuc:settings"]) || {};
  if (!settings.desktopNotifications) return;
  const state = settingsStored[OPENAI_NOTIFY_KEY] || {};
  let changed = false;

  for (const bucket of snapshot.buckets) {
    const crossed = NOTIFY_THRESHOLDS.filter(value => bucket.pct >= value);
    const top = crossed.length ? Math.max(...crossed) : 0;
    const prior = state[bucket.key];
    if (!prior || prior.resetsAt !== bucket.resetsAt) {
      state[bucket.key] = { resetsAt: bucket.resetsAt || null, notified: 0, at: 0 };
      changed = true;
    }
    const record = state[bucket.key];
    if (!top) {
      if (record.notified) { record.notified = 0; changed = true; }
      continue;
    }
    if (top < record.notified) continue;
    if (top === record.notified && Date.now() - record.at < NOTIFY_REPEAT_MS) continue;
    const remaining = countdown(bucket.resetsAt);
    const message = remaining
      ? `${bucket.label} is at ${Math.round(bucket.pct)}%. It resets in ${remaining}.`
      : `${bucket.label} is at ${Math.round(bucket.pct)}%.`;
    try {
      chrome.notifications.create(`cuc-openai-${bucket.key}-${top}`, {
        type: "basic",
        iconUrl: chrome.runtime.getURL("icons/icon128.png"),
        title: `${snapshot.surface === "codex" ? "Codex" : snapshot.surface === "work" ? "Work" : "ChatGPT"} usage heads-up`,
        message,
        priority: top >= 95 ? 2 : 1,
      });
    } catch { /* best effort */ }
    record.notified = top;
    record.at = Date.now();
    changed = true;
  }
  if (changed) await chrome.storage.local.set({ [OPENAI_NOTIFY_KEY]: state }).catch(() => {});
}

async function claimOpenAICaveman(conversationKey) {
  const stored = await chrome.storage.local.get([OPENAI_CAVEMAN_KEY]);
  const map = stored[OPENAI_CAVEMAN_KEY] || {};
  if (map[conversationKey]) return { claimed: false };
  map[conversationKey] = Date.now();
  const keys = Object.keys(map).sort((a, b) => map[a] - map[b]);
  for (const key of keys.slice(0, Math.max(0, keys.length - MAX_CAVEMAN_ENTRIES))) delete map[key];
  await chrome.storage.local.set({ [OPENAI_CAVEMAN_KEY]: map });
  return { claimed: true };
}

async function unclaimOpenAICaveman(conversationKey) {
  const stored = await chrome.storage.local.get([OPENAI_CAVEMAN_KEY]);
  const map = stored[OPENAI_CAVEMAN_KEY] || {};
  if (!map[conversationKey]) return;
  delete map[conversationKey];
  await chrome.storage.local.set({ [OPENAI_CAVEMAN_KEY]: map });
}

async function ensureOpenAIOffscreenDocument() {
  if (!chrome.offscreen?.createDocument) throw new Error("offscreen-unsupported");
  if (await chrome.offscreen.hasDocument?.()) return;
  if (!openaiOffscreenCreating) {
    openaiOffscreenCreating = chrome.offscreen.createDocument({
      url: "src/offscreen.html",
      reasons: ["WORKERS"],
      justification: "Convert a user-selected office file to Markdown locally for Companion.",
    }).finally(() => { openaiOffscreenCreating = null; });
  }
  await openaiOffscreenCreating;
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!isPlainRecord(message) || typeof message.type !== "string") return false;

  if (message.type === "cuc:openai-open-options") {
    if (!isTrustedOpenAIContentSender(sender) || !hasOnlyKeys(message, new Set(["type"]))) return false;
    chrome.runtime.openOptionsPage();
    return false;
  }

  if (message.type === "cuc:openai-usage-updated") {
    if (!isTrustedOpenAIContentSender(sender)) return false;
    const snapshot = normalizeOpenAIMessage(message);
    if (!snapshot) return false;
    serializeOpenAI(async () => {
      await storeOpenAIUsage(snapshot);
      applyOpenAIBadge(snapshot.maxUtilizationPct);
      await maybeNotifyOpenAI(snapshot);
    }).catch(() => {});
    return false;
  }

  if (message.type === "cuc:openai-claim-caveman-injection" || message.type === "cuc:openai-unclaim-caveman-injection") {
    if (!isTrustedOpenAIContentSender(sender)) return false;
    if (!hasOnlyKeys(message, new Set(["type", "conversationKey"]))) return false;
    if (!validConversationKey(message.conversationKey)) return false;
    const task = message.type === "cuc:openai-claim-caveman-injection"
      ? () => claimOpenAICaveman(message.conversationKey)
      : async () => { await unclaimOpenAICaveman(message.conversationKey); return { ok: true }; };
    serializeOpenAI(task).then(sendResponse, () => sendResponse(message.type.includes("claim") ? { claimed: false } : { ok: false }));
    return true;
  }

  if (message.type === "cuc:openai-convert-file") {
    if (!isTrustedOpenAIContentSender(sender)) return false;
    if (!hasOnlyKeys(message, new Set(["type", "dataUrl", "ext"]))) return false;
    if (!CONVERTIBLE_EXTENSIONS.has(message.ext)) return false;
    if (typeof message.dataUrl !== "string" || !message.dataUrl.startsWith("data:") || message.dataUrl.length > MAX_CONVERT_DATAURL_CHARS) return false;
    (async () => {
      await ensureOpenAIOffscreenDocument();
      return chrome.runtime.sendMessage({ type: "cuc:offscreen-convert", dataUrl: message.dataUrl, ext: message.ext });
    })().then(
      result => sendResponse(result || { ok: false, error: "no response from converter" }),
      error => sendResponse({ ok: false, error: String(error?.message || error) }),
    );
    return true;
  }

  return false;
});
