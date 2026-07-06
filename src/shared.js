(() => {
  const FIVE_HOURS_MS = 5 * 60 * 60 * 1000;
  const DAY_MS = 24 * 60 * 60 * 1000;
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
      return "Accurate till 8/31/26";
    }
    return "Pricing current";
  }

  const DEFAULT_SETTINGS = {
    displayMode: "both",
    defaultModel: "claude-sonnet-5-intro",
    // budgetMode is fixed to "daily" — the settings page no longer exposes
    // session/monthly views since daily is the framing people actually use.
    budgetMode: "daily",
    dailyBudgetUsd: 5,
    monthlyBudgetUsd: 75,
    sessionBudgetUsd: 2.5,
    planName: "Claude Pro / Max / Team",
    showWidget: true,
    // The following are load-bearing for the estimate math but are no
    // longer exposed as adjustable knobs in Settings, to keep the UI simple.
    // Change these values here if the defaults ever need retuning.
    showPlainEnglishTips: true,
    countHiddenContext: true,
    contextCarryForwardRatio: 0.55,
    safetyMargin: 1.2,
    autoResetSession: true,
    priceBasisLabel: "API-equivalent estimate",
    widgetPosition: null,
    widgetAnchorMode: "docked",
    widgetCollapsed: false,
    showNativeLimits: true,
    showOpusLimit: true
  };

  function todayKey(date = new Date()) {
    return date.toISOString().slice(0, 10);
  }

  function monthKey(date = new Date()) {
    return date.toISOString().slice(0, 7);
  }

  function emptyUsage(now = Date.now()) {
    return {
      version: 1,
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
      lastResetReason: "initial"
    };
  }

  function normalizeWhitespace(text) {
    return String(text || "").replace(/\s+/g, " ").trim();
  }

  function estimateTokensFromText(text, modelKey = "claude-sonnet-5-intro") {
    const normalized = normalizeWhitespace(text);
    if (!normalized) return 0;

    const model = MODEL_PRICES[modelKey] || MODEL_PRICES[DEFAULT_SETTINGS.defaultModel];
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

    if (tokenizerAvailable()) {
      try {
        const tokens = globalThis.GPTTokenizer_o200k_base.countTokens(normalized);
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

  function addUsageEvent(usage, event, settings) {
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
    usage.conversations[conversation].title = event.title || usage.conversations[conversation].title || conversation;

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

  function resetSession(usage, reason = "manual") {
    const now = Date.now();
    return {
      ...emptyUsage(now),
      days: usage.days || {},
      months: usage.months || {},
      conversations: usage.conversations || {},
      lastResetReason: reason
    };
  }

  function getBudgetProgress(usage, settings) {
    const day = todayKey();
    const month = monthKey();
    const daily = usage.days?.[day]?.estimatedUsd || 0;
    const monthly = usage.months?.[month]?.estimatedUsd || 0;
    const session = usage.totals?.estimatedUsd || 0;

    if (settings.budgetMode === "monthly") {
      return { label: "Monthly budget", value: monthly, budget: Number(settings.monthlyBudgetUsd || 0) };
    }
    if (settings.budgetMode === "session") {
      return { label: "Session budget", value: session, budget: Number(settings.sessionBudgetUsd || 0) };
    }
    return { label: "Daily budget", value: daily, budget: Number(settings.dailyBudgetUsd || 0) };
  }

  function usageLevel(progress) {
    if (!progress.budget) return "neutral";
    const pct = progress.value / progress.budget;
    if (pct >= 1) return "high";
    if (pct >= 0.75) return "medium";
    return "low";
  }

  function plainEnglishTip(usage, settings) {
    const recent = usage.recentEvents || [];
    const lastInput = recent.find(e => e.kind === "input");
    const lastOutput = recent.find(e => e.kind === "output");
    const progress = getBudgetProgress(usage, settings);
    const level = usageLevel(progress);

    if (level === "high") {
      return `You are at or above your ${progress.label.toLowerCase()}. Consider starting a fresh chat, shortening file context, or switching to a lower-cost model.`;
    }
    if (lastInput && lastInput.inputTokens > 12000) {
      return "This looks like a heavy prompt. Large files, long instructions, or long chat history may be driving usage.";
    }
    if (lastOutput && lastOutput.outputTokens > 5000) {
      return "Claude produced a long response. Asking for shorter answers can reduce usage.";
    }
    if ((usage.totals?.messages || 0) >= 12) {
      return "This chat has a lot of back-and-forth. A fresh chat with a short summary may use less context.";
    }
    return "Usage looks normal. For longer work, group related asks and ask for concise output.";
  }

  function detectModelFromText(text) {
    const lower = String(text || "").toLowerCase();
    if (lower.includes("fable") || lower.includes("mythos")) return "claude-fable-5";
    if (lower.includes("opus")) return "claude-opus-4-8";
    if (lower.includes("haiku")) return "claude-haiku-4-5";
    if (lower.includes("sonnet 5")) return "claude-sonnet-5-intro";
    if (lower.includes("sonnet")) return "claude-sonnet-4-6";
    return null;
  }

  function clamp(num, min, max) {
    return Math.min(max, Math.max(min, num));
  }

  globalThis.ClaudeUsageCompanion = {
    FIVE_HOURS_MS,
    DAY_MS,
    MODEL_PRICES,
    DEFAULT_SETTINGS,
    emptyUsage,
    estimateTokensFromText,
    estimateTokensPrecise,
    tokenizerAvailable,
    estimateCostUsd,
    formatUsd,
    formatTokens,
    makeStorageKey,
    currentConversationId,
    addUsageEvent,
    shouldResetSession,
    resetSession,
    getBudgetProgress,
    usageLevel,
    plainEnglishTip,
    detectModelFromText,
    resolveModelKey,
    accurateUntilLabel,
    todayKey,
    monthKey,
    clamp
  };
})();
