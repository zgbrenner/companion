(() => {
  const FIVE_HOURS_MS = 5 * 60 * 60 * 1000;
  const DAY_MS = 24 * 60 * 60 * 1000;
  const USAGE_VERSION = 2;
  // Sonnet 5 intro pricing ends at 2026-09-01T00:00:00Z. After this, the
  // standard rate applies automatically — this must not rely on a person
  // manually flipping a dropdown after the date passes.
  const SONNET_5_PRICING_CUTOFF_MS = Date.parse("2026-09-01T00:00:00Z");

  const MODEL_PRICES = {
    "claude-sonnet-5-intro": {
      label: "Claude Sonnet 5 — intro pricing (through Aug 31, 2026)",
      inputPerMTok: 2,
      outputPerMTok: 10,
      tokenizerMultiplier: 1.3
    },
    "claude-sonnet-5-standard": {
      label: "Claude Sonnet 5 — standard pricing (from Sept 1, 2026)",
      inputPerMTok: 3,
      outputPerMTok: 15,
      tokenizerMultiplier: 1.3
    },
    "claude-sonnet-4-6": {
      label: "Claude Sonnet 4.6 / 4.5",
      inputPerMTok: 3,
      outputPerMTok: 15,
      tokenizerMultiplier: 1
    },
    "claude-opus-4-8": {
      label: "Claude Opus 4.8 / 4.7 / 4.6 / 4.5",
      inputPerMTok: 5,
      outputPerMTok: 25,
      tokenizerMultiplier: 1.3
    },
    "claude-haiku-4-5": {
      label: "Claude Haiku 4.5",
      inputPerMTok: 1,
      outputPerMTok: 5,
      tokenizerMultiplier: 1
    },
    "claude-fable-5": {
      label: "Claude Fable 5 / Mythos 5",
      inputPerMTok: 10,
      outputPerMTok: 50,
      tokenizerMultiplier: 1.3
    }
  };

  // If the person (or a stored setting) picked the intro-pricing key after
  // the cutoff has passed, silently resolve to the standard-pricing key so
  // estimates don't quietly stay wrong forever.
  function resolveModelKey(modelKey) {
    if (modelKey === "claude-sonnet-5-intro" && Date.now() >= SONNET_5_PRICING_CUTOFF_MS) {
      return "claude-sonnet-5-standard";
    }
    return modelKey;
  }

  function accurateUntilLabel(modelKey) {
    if (resolveModelKey(modelKey) === "claude-sonnet-5-intro") {
      return "Intro pricing until 8/31/26";
    }
    return "Current pricing";
  }

  const DEFAULT_SETTINGS = {
    displayMode: "both",
    defaultModel: "claude-sonnet-5-intro",
    showWidget: true,
    // The following are load-bearing for the estimate math but are no
    // longer exposed as adjustable knobs in Settings, to keep the UI simple.
    // Change these values here if the defaults ever need retuning.
    showPlainEnglishTips: true,
    countHiddenContext: false,
    contextCarryForwardRatio: 0,
    safetyMargin: 1.2,
    autoResetSession: true,
    organizationId: "1e16048b-a724-40fd-b78b-bcf3c7f9af9a",
    enterpriseMonthlyLimitUsd: 100,
    showNativeLimits: true
  };

  // Key daily/monthly buckets by the user's LOCAL date, not UTC. Using
  // toISOString() (UTC) made "today" roll over at UTC midnight, so a US user
  // would see their daily budget reset in the afternoon/evening instead of at
  // their own local midnight.
  function todayKey(date = new Date()) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, "0");
    const d = String(date.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }

  function monthKey(date = new Date()) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, "0");
    return `${y}-${m}`;
  }

  function emptyUsage(now = Date.now()) {
    return {
      version: USAGE_VERSION,
      sessionStartedAt: now,
      lastUpdatedAt: now,
      totals: {
        inputTokens: 0,
        outputTokens: 0,
        estimatedUsd: 0,
        messages: 0,
        responses: 0,
        attachmentEvents: 0
      },
      days: {},
      months: {},
      conversations: {},
      recentEvents: [],
      // Ring buffer of recently-applied event ids, used to make addUsageEvent
      // idempotent. Needed because an event can be delivered twice: the
      // background writes it, then dies before acknowledging, so the content
      // script's fallback path re-submits the same event. Without dedup that
      // would double-count usage.
      appliedEventIds: [],
      // Ring buffer of event ids already moved by migrateConversationEvents,
      // so a retried/duplicate migration (background restart, message
      // resend) doesn't shift the same tokens twice.
      migratedEventIds: [],
      lastResetReason: "initial"
    };
  }

  function normalizeWhitespace(text) {
    return String(text || "").replace(/\s+/g, " ").trim();
  }

  function normalizeUsage(usage) {
    if (!usage) return emptyUsage();
    if (usage.version !== USAGE_VERSION) {
      // Schema bump: don't silently throw away months of history. The
      // days/months/conversations buckets are plain aggregate maps whose
      // shape has been stable across versions, so salvage them when they
      // look sane and only reset the session-level state.
      const salvaged = emptyUsage();
      for (const key of ["days", "months", "conversations"]) {
        if (usage[key] && typeof usage[key] === "object" && !Array.isArray(usage[key])) {
          salvaged[key] = usage[key];
        }
      }
      salvaged.lastResetReason = "version-migration";
      return pruneUsage(salvaged);
    }
    return usage;
  }

  function estimateTokensFromText(text, modelKey = "claude-sonnet-5-intro") {
    const normalized = normalizeWhitespace(text);
    if (!normalized) return 0;

    const resolvedKey = resolveModelKey(modelKey);
    const model = MODEL_PRICES[resolvedKey] || MODEL_PRICES[resolveModelKey(DEFAULT_SETTINGS.defaultModel)];
    const chars = normalized.length;
    const words = normalized.split(/\s+/).filter(Boolean).length;

    // Hybrid estimate. English text often lands near 3.5–4.5 chars/token, while
    // dense legal/technical content can vary. Keep the estimate intentionally
    // conservative for budget warnings.
    const charEstimate = chars / 3.8;
    const wordEstimate = words * 1.33;
    const base = Math.max(charEstimate, wordEstimate);
    return Math.ceil(base * (model.tokenizerMultiplier || 1));
  }

  // If a real tokenizer is vendored (see src/o200k_base.js, loaded as
  // GPTTokenizer_o200k_base — see README "Token counting accuracy"), prefer
  // it. It is NOT a Claude tokenizer — no public one exists — but a
  // well-regarded model's BPE tokenizer tends to track English-prose token
  // counts more closely than character/word counting. Falls back to the
  // heuristic automatically and silently when the tokenizer isn't present,
  // so this function is always safe to call regardless of whether the
  // vendored file has been added.
  function tokenizerAvailable() {
    return Boolean(globalThis.GPTTokenizer_o200k_base?.countTokens);
  }

  function estimateTokensPrecise(text, modelKey = "claude-sonnet-5-intro") {
    const normalized = normalizeWhitespace(text);
    if (!normalized) return { tokens: 0, method: "none" };

    const resolvedKey = resolveModelKey(modelKey);
    const model = MODEL_PRICES[resolvedKey] || MODEL_PRICES[resolveModelKey(DEFAULT_SETTINGS.defaultModel)];
    if (tokenizerAvailable()) {
      try {
        const rawTokens = globalThis.GPTTokenizer_o200k_base.countTokens(normalized);
        // Apply the same tokenizerMultiplier the heuristic path uses. o200k is
        // not Claude's tokenizer; for several models Claude's tokenizer runs
        // denser, so both estimate paths must scale by the same factor or the
        // number would jump ~23% depending on which path happened to run.
        const tokens = Math.ceil(rawTokens * (model.tokenizerMultiplier || 1));
        return { tokens, method: "tokenizer" };
      } catch {
        // Fall through to heuristic on any tokenizer error (e.g. unexpected
        // input) rather than letting a tokenizer bug break usage tracking.
      }
    }
    return { tokens: estimateTokensFromText(normalized, modelKey), method: "heuristic" };
  }

  function estimateCostUsd(inputTokens, outputTokens, modelKey, settings = DEFAULT_SETTINGS) {
    const resolvedKey = resolveModelKey(modelKey);
    const model = MODEL_PRICES[resolvedKey] || MODEL_PRICES[resolveModelKey(settings.defaultModel)] || MODEL_PRICES[DEFAULT_SETTINGS.defaultModel];
    const raw = (inputTokens / 1_000_000) * model.inputPerMTok + (outputTokens / 1_000_000) * model.outputPerMTok;
    return Number((raw * (settings.safetyMargin || 1)).toFixed(6));
  }

  function formatUsd(value) {
    const amount = Number(value || 0);
    if (amount < 0.01 && amount > 0) return `$${amount.toFixed(4)}`;
    if (amount < 10) return `$${amount.toFixed(2)}`;
    return `$${Math.round(amount).toLocaleString()}`;
  }

  function formatTokens(value) {
    const n = Number(value || 0);
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
    if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
    return String(Math.round(n));
  }

  function makeStorageKey(prefix = "cuc") {
    return `${prefix}:usage`;
  }

  function currentConversationId() {
    const path = location.pathname || "";
    const match = path.match(/chat\/([^/?#]+)/i) || path.match(/conversation\/([^/?#]+)/i);
    return match ? match[1] : "home-or-new-chat";
  }

  function updateBucket(bucket, event) {
    bucket.inputTokens = (bucket.inputTokens || 0) + (event.inputTokens || 0);
    // rawInputTokens excludes the carry-forward context estimate — it's the
    // actual new prompt+attachment size for that turn. Kept separately so
    // getContextTokensForConversation can reference real growth instead of
    // multiplying an already-inflated cumulative total on every message.
    bucket.rawInputTokens = (bucket.rawInputTokens || 0) + (event.rawInputTokens ?? event.inputTokens ?? 0);
    bucket.outputTokens = (bucket.outputTokens || 0) + (event.outputTokens || 0);
    bucket.estimatedUsd = Number(((bucket.estimatedUsd || 0) + (event.estimatedUsd || 0)).toFixed(6));
    bucket.messages = (bucket.messages || 0) + (event.kind === "input" ? 1 : 0);
    bucket.responses = (bucket.responses || 0) + (event.kind === "output" ? 1 : 0);
    bucket.attachmentEvents = (bucket.attachmentEvents || 0) + (event.attachmentCount || 0);
    return bucket;
  }

  // Keep historical buckets bounded. days/months/conversations otherwise grow
  // forever and are preserved across session resets, so a long-running user
  // would slowly inflate the stored blob (re-serialized on every debounced
  // write) toward the chrome.storage.local quota, at which point writes start
  // failing silently and usage tracking stops persisting.
  const MAX_DAY_BUCKETS = 90;
  const MAX_MONTH_BUCKETS = 12;
  const MAX_CONVERSATIONS = 50;

  function keepNewestKeys(map, limit, tieBreakByString = false) {
    if (!map) return;
    const keys = Object.keys(map);
    if (keys.length <= limit) return;
    const ordered = keys.sort((a, b) => {
      const la = map[a]?.lastUpdatedAt;
      const lb = map[b]?.lastUpdatedAt;
      if (typeof la === "number" || typeof lb === "number") {
        return (lb || 0) - (la || 0);
      }
      // Date-string keys (days/months) sort lexicographically = chronologically.
      return tieBreakByString ? (a < b ? 1 : -1) : 0;
    });
    for (const key of ordered.slice(limit)) delete map[key];
  }

  function pruneUsage(usage) {
    keepNewestKeys(usage.days, MAX_DAY_BUCKETS, true);
    keepNewestKeys(usage.months, MAX_MONTH_BUCKETS, true);
    keepNewestKeys(usage.conversations, MAX_CONVERSATIONS, false);
    return usage;
  }

  function addBucketDelta(bucket, delta, sign) {
    bucket.inputTokens = Math.max(0, (bucket.inputTokens || 0) + sign * delta.inputTokens);
    bucket.rawInputTokens = Math.max(0, (bucket.rawInputTokens || 0) + sign * delta.rawInputTokens);
    bucket.outputTokens = Math.max(0, (bucket.outputTokens || 0) + sign * delta.outputTokens);
    bucket.estimatedUsd = Number(Math.max(0, (bucket.estimatedUsd || 0) + sign * delta.estimatedUsd).toFixed(6));
    bucket.messages = Math.max(0, (bucket.messages || 0) + sign * delta.messages);
    bucket.responses = Math.max(0, (bucket.responses || 0) + sign * delta.responses);
    bucket.attachmentEvents = Math.max(0, (bucket.attachmentEvents || 0) + sign * delta.attachmentEvents);
    return bucket;
  }

  const MAX_MIGRATED_EVENT_IDS = 300;

  // Moves a specific set of previously-recorded events from one conversation
  // bucket to another — used to fix up prompts/responses that were recorded
  // under the "home-or-new-chat" bucket before claude.ai assigned the chat a
  // real conversation id. Only touches usage.conversations: totals/days/
  // months are not conversation-scoped, so they're already correct and must
  // not be double-adjusted here. Idempotent per event id (via
  // usage.migratedEventIds) so a retried/duplicate migration message is safe.
  function migrateConversationEvents(usage, fromId, toId, events) {
    if (!fromId || !toId || fromId === toId) return usage;
    if (!Array.isArray(events) || events.length === 0) return usage;

    if (!Array.isArray(usage.migratedEventIds)) usage.migratedEventIds = [];
    const toMigrate = events.filter(e => e && (!e.id || !usage.migratedEventIds.includes(e.id)));
    if (toMigrate.length === 0) return usage;

    usage.conversations = usage.conversations || {};
    const fromBucket = usage.conversations[fromId];
    usage.conversations[toId] = usage.conversations[toId] || {};
    const toBucket = usage.conversations[toId];

    for (const event of toMigrate) {
      const delta = {
        inputTokens: event.inputTokens || 0,
        rawInputTokens: event.rawInputTokens ?? event.inputTokens ?? 0,
        outputTokens: event.outputTokens || 0,
        estimatedUsd: event.estimatedUsd || 0,
        messages: event.kind === "input" ? 1 : 0,
        responses: event.kind === "output" ? 1 : 0,
        attachmentEvents: event.attachmentCount || 0
      };
      if (fromBucket) addBucketDelta(fromBucket, delta, -1);
      addBucketDelta(toBucket, delta, 1);
      if (event.id) usage.migratedEventIds.push(event.id);
    }
    toBucket.lastUpdatedAt = Date.now();

    if (usage.migratedEventIds.length > MAX_MIGRATED_EVENT_IDS) {
      usage.migratedEventIds = usage.migratedEventIds.slice(-MAX_MIGRATED_EVENT_IDS);
    }

    pruneUsage(usage);
    return usage;
  }

  const MAX_APPLIED_EVENT_IDS = 300;

  function addUsageEvent(usage, event, settings) {
    // Idempotency guard: if this exact event was already folded in (e.g. the
    // background applied it, then the content-script fallback re-submitted it
    // after a lost acknowledgement), skip it so usage isn't double-counted.
    if (event.id) {
      if (!Array.isArray(usage.appliedEventIds)) usage.appliedEventIds = [];
      if (usage.appliedEventIds.includes(event.id)) return usage;
      usage.appliedEventIds.push(event.id);
      if (usage.appliedEventIds.length > MAX_APPLIED_EVENT_IDS) {
        usage.appliedEventIds = usage.appliedEventIds.slice(-MAX_APPLIED_EVENT_IDS);
      }
    }

    const now = event.at || Date.now();
    const day = todayKey(new Date(now));
    const month = monthKey(new Date(now));
    const conversation = event.conversationId || "unknown";

    usage.lastUpdatedAt = now;
    usage.totals = updateBucket(usage.totals || {}, event);
    usage.days[day] = updateBucket(usage.days[day] || {}, event);
    usage.months[month] = updateBucket(usage.months[month] || {}, event);
    usage.conversations[conversation] = updateBucket(usage.conversations[conversation] || {}, event);
    usage.conversations[conversation].lastUpdatedAt = now;
    // Intentionally do NOT persist a human-readable conversation title.
    // claude.ai's title is auto-derived from the user's prompt content (names,
    // case topics, deal names for the HR/Legal/Finance audience this targets),
    // so storing it would violate the "no prompt-derived text on disk" posture.
    // The opaque conversation id is enough — the title is never displayed.

    pruneUsage(usage);

    const publicEvent = {
      at: now,
      kind: event.kind,
      inputTokens: event.inputTokens || 0,
      outputTokens: event.outputTokens || 0,
      estimatedUsd: event.estimatedUsd || 0,
      modelKey: event.modelKey || settings.defaultModel,
      reason: event.reason || "activity"
    };
    usage.recentEvents = [publicEvent, ...(usage.recentEvents || [])].slice(0, 60);
    return usage;
  }

  function shouldResetSession(usage, settings) {
    if (!settings.autoResetSession) return false;
    return Date.now() - (usage.sessionStartedAt || 0) > FIVE_HOURS_MS;
  }

  function resetSession(usage, reason = "manual", options = {}) {
    const now = Date.now();
    return {
      ...emptyUsage(now),
      days: usage.days || {},
      months: usage.months || {},
      // A user-initiated reset clears the per-chat estimates too — that's the
      // number people actually see, so the button must have a visible effect.
      // The automatic five-hour rollover keeps them: an open chat's estimate
      // shouldn't silently zero out mid-conversation just because time passed.
      conversations: options.clearConversations ? {} : (usage.conversations || {}),
      // Carry the idempotency ring buffers through the reset. Wiping them
      // reopened the exact double-count window they exist to close: a reset
      // landing between the background's apply and a content-script fallback
      // re-submit made the retried event look brand new.
      appliedEventIds: Array.isArray(usage.appliedEventIds) ? usage.appliedEventIds : [],
      migratedEventIds: Array.isArray(usage.migratedEventIds) ? usage.migratedEventIds : [],
      lastResetReason: reason
    };
  }

  function getTodayUsage(usage, date = new Date()) {
    return usage.days?.[todayKey(date)] || {};
  }

  function getMonthUsage(usage, date = new Date()) {
    return usage.months?.[monthKey(date)] || {};
  }

  // Rows for the CSV export in Settings: one line per stored local-date
  // bucket, newest first. Contains only counts and estimates — never any
  // prompt/response text, consistent with the privacy posture.
  function usageHistoryRows(usage) {
    const days = usage?.days || {};
    return Object.keys(days)
      .sort()
      .reverse()
      .map(day => {
        const bucket = days[day] || {};
        return {
          date: day,
          messages: bucket.messages || 0,
          responses: bucket.responses || 0,
          inputTokens: bucket.inputTokens || 0,
          outputTokens: bucket.outputTokens || 0,
          attachmentEvents: bucket.attachmentEvents || 0,
          estimatedUsd: Number((bucket.estimatedUsd || 0).toFixed(4))
        };
      });
  }

  function usageHistoryCsv(usage) {
    const header = "date,messages,responses,input_tokens,output_tokens,attachments,estimated_usd";
    const lines = usageHistoryRows(usage).map(row =>
      [row.date, row.messages, row.responses, row.inputTokens, row.outputTokens, row.attachmentEvents, row.estimatedUsd].join(",")
    );
    return [header, ...lines].join("\n");
  }

  function getConversationUsage(usage, conversationId = currentConversationId()) {
    return usage.conversations?.[conversationId] || {};
  }

  function detectModelFromText(text) {
    const lower = String(text || "").toLowerCase();
    if (!lower) return null;
    if (lower.includes("fable") || lower.includes("mythos")) return "claude-fable-5";
    if (lower.includes("opus")) return "claude-opus-4-8";
    if (lower.includes("haiku")) return "claude-haiku-4-5";
    if (lower.includes("sonnet 5")) return "claude-sonnet-5-intro";
    if (lower.includes("sonnet")) return "claude-sonnet-4-6";
    return null;
  }

  function detectModelFromId(modelId) {
    const lower = String(modelId || "").toLowerCase();
    if (!lower) return null;
    if (lower.includes("fable") || lower.includes("mythos")) return "claude-fable-5";
    if (lower.includes("opus")) return "claude-opus-4-8";
    if (lower.includes("haiku")) return "claude-haiku-4-5";
    if (lower.includes("sonnet-5") || lower.includes("sonnet_5") || lower.includes("sonnet 5")) {
      return "claude-sonnet-5-intro";
    }
    if (lower.includes("sonnet")) return "claude-sonnet-4-6";
    return null;
  }

  function clamp(num, min, max) {
    return Math.min(max, Math.max(min, num));
  }

  globalThis.ClaudeUsageCompanion = {
    FIVE_HOURS_MS,
    DAY_MS,
    USAGE_VERSION,
    MODEL_PRICES,
    DEFAULT_SETTINGS,
    emptyUsage,
    normalizeUsage,
    estimateTokensFromText,
    estimateTokensPrecise,
    tokenizerAvailable,
    estimateCostUsd,
    formatUsd,
    formatTokens,
    makeStorageKey,
    currentConversationId,
    addUsageEvent,
    migrateConversationEvents,
    pruneUsage,
    getTodayUsage,
    getMonthUsage,
    usageHistoryRows,
    usageHistoryCsv,
    shouldResetSession,
    resetSession,
    getConversationUsage,
    detectModelFromText,
    detectModelFromId,
    resolveModelKey,
    accurateUntilLabel,
    todayKey,
    monthKey,
    clamp
  };
})();
