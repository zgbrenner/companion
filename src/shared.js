(() => {
  // Sonnet 5 intro pricing ends at 2026-09-01T00:00:00Z. After this, the
  // standard rate applies automatically — this must not rely on a person
  // manually flipping a dropdown after the date passes.
  const SONNET_5_PRICING_CUTOFF_MS = Date.parse("2026-09-01T00:00:00Z");

  // Public Anthropic API-equivalent pricing (USD per million tokens). Used
  // ONLY to convert Claude's real dollar spend into approximate token counts
  // — never the other way around. Update when Anthropic changes pricing.
  const MODEL_PRICES = {
    "claude-sonnet-5-intro": {
      label: "Claude Sonnet 5 — intro pricing (through Aug 31, 2026)",
      inputPerMTok: 2,
      outputPerMTok: 10
    },
    "claude-sonnet-5-standard": {
      label: "Claude Sonnet 5 — standard pricing (from Sept 1, 2026)",
      inputPerMTok: 3,
      outputPerMTok: 15
    },
    "claude-sonnet-4-6": {
      label: "Claude Sonnet 4.6 / 4.5",
      inputPerMTok: 3,
      outputPerMTok: 15
    },
    "claude-opus-4-8": {
      label: "Claude Opus 4.8 / 4.7 / 4.6 / 4.5",
      inputPerMTok: 5,
      outputPerMTok: 25
    },
    "claude-haiku-4-5": {
      label: "Claude Haiku 4.5",
      inputPerMTok: 1,
      outputPerMTok: 5
    },
    "claude-fable-5": {
      label: "Claude Fable 5 / Mythos 5",
      inputPerMTok: 10,
      outputPerMTok: 50
    }
  };

  // If the person (or a stored setting) picked the intro-pricing key after
  // the cutoff has passed, silently resolve to the standard-pricing key so
  // token conversions don't quietly stay wrong forever.
  function resolveModelKey(modelKey) {
    if (modelKey === "claude-sonnet-5-intro" && Date.now() >= SONNET_5_PRICING_CUTOFF_MS) {
      return "claude-sonnet-5-standard";
    }
    return modelKey;
  }

  const DEFAULT_SETTINGS = {
    displayMode: "both",
    // Fallback model for converting dollars to tokens when the active model
    // can't be detected (and for spend rows without a model breakdown).
    defaultModel: "claude-sonnet-5-intro",
    showWidget: true,
    showPlainEnglishTips: true,
    // Caveman Mode: terse-reply instruction + prompt trimming + file→Markdown.
    cavemanMode: false,
    // Whether the Caveman Mode control appears in the widget at all. When
    // false the row, drop zone, and send-interception are all suppressed —
    // users who don't want the feature can hide it entirely from Settings.
    showCavemanMode: true,
    // Whether the "Spent this session" meter block (headline value, bar, and
    // the Today/session-detail line under it) is shown.
    showSessionSpend: true,
    // Whether the rolling 5-hour session-limit row is shown.
    showSessionLimit: true,
    // Whether the rolling 7-day weekly-limit row is shown.
    showWeeklyLimit: true,
    // Whether the weekly Opus-limit row is shown. Still only rendered once
    // there's actual Opus usage to report — this just lets it be hidden even
    // when that data exists.
    showOpusLimit: true,
    // Whether the monthly usage-credit allowance is shown (the "Monthly
    // allowance" row in the widget and the "This month" figure in the popup).
    // Personal-plan users may not want a monthly-credit view at all.
    showMonthlyCredits: true,
    desktopNotifications: true
  };

  // Retired setting, kept ONLY as a migration source in mergeSettings below —
  // never read anywhere else and never written back into merged output.
  const LEGACY_SHOW_NATIVE_LIMITS_KEY = "showNativeLimits";

  // Every consumer merges stored settings on top of the defaults through this
  // one function so the retired `showNativeLimits` boolean (replaced by the
  // five per-metric toggles above) migrates consistently everywhere. A user
  // who had `showNativeLimits: false` — and hasn't already been migrated or
  // customized any of the new per-limit keys — keeps all their rolling limits
  // hidden after upgrading. `showNativeLimits: true` (or absent) just falls
  // through to the new defaults (all visible). The legacy key itself is never
  // present in the returned object.
  function mergeSettings(stored) {
    const merged = { ...DEFAULT_SETTINGS, ...(stored || {}) };
    if (stored && stored[LEGACY_SHOW_NATIVE_LIMITS_KEY] === false) {
      const hasNewLimitKeys = ["showSessionLimit", "showWeeklyLimit", "showOpusLimit"]
        .some(key => Object.prototype.hasOwnProperty.call(stored, key));
      if (!hasNewLimitKeys) {
        merged.showSessionLimit = false;
        merged.showWeeklyLimit = false;
        merged.showOpusLimit = false;
        if (!Object.prototype.hasOwnProperty.call(stored, "showMonthlyCredits")) {
          merged.showMonthlyCredits = false;
        }
      }
    }
    delete merged[LEGACY_SHOW_NATIVE_LIMITS_KEY];
    return merged;
  }

  // The four per-metric visibility prefs covering the rolling/monthly limit
  // buckets. One source of truth for "is any limit row visible at all?" so
  // the widget, the popup, and the badge/notification filters can't drift.
  const NATIVE_LIMIT_PREF_KEYS = [
    "showSessionLimit",
    "showWeeklyLimit",
    "showOpusLimit",
    "showMonthlyCredits"
  ];

  function anyNativeLimitPrefVisible(settings) {
    return NATIVE_LIMIT_PREF_KEYS.some(key => settings?.[key] !== false);
  }

  // ---- Real-spend accounting -----------------------------------------------
  //
  // Every dollar figure below comes from Claude's own monthly usage-credit
  // counter (extra_usage.used_credits — cumulative within the month, accurate
  // to the cent). The extension samples it and derives:
  //   • session spend  = counter now − counter when this browser session began
  //   • daily spend    = counter at end of day − counter at start of day
  // No token counting, no text inspection — this is Claude's own bill.
  //
  // Both figures cover ALL of the account's activity (every tab, device, and
  // surface billed to the same monthly counter), and the UI labels them that
  // way.

  // Counter drops smaller than this are treated as out-of-order samples (two
  // tabs' polls racing each other) and absorbed by max(); only a substantial
  // drop means the credits were genuinely adjusted/reset and baselines must
  // re-anchor. Without this threshold, a one-cent stale sample arriving late
  // would silently wipe the whole session delta.
  const COUNTER_DROP_REANCHOR_USD = 0.5;

  // Session store (chrome.storage.session — clears when the browser closes,
  // which is exactly the lifetime "this session" should have):
  //   { baselineUsd, lastUsd, monthKey, startedAt }
  // Pure state-transition helper; the background service worker is the single
  // writer and persists whatever this returns.
  function applySessionSpendSample(session, sample, now = Date.now()) {
    const mk = monthKey(new Date(now));
    const usedUsd = Number(sample?.usedUsd);
    if (!Number.isFinite(usedUsd)) return session || null;

    const counterWentBackwards = session
      && usedUsd < (session.lastUsd ?? session.baselineUsd) - COUNTER_DROP_REANCHOR_USD;
    if (!session || session.monthKey !== mk || counterWentBackwards) {
      // New browser session, month rollover, or the counter genuinely dropped
      // (credits adjusted/reset) — start a fresh baseline rather than showing
      // a negative or inflated delta.
      return { baselineUsd: usedUsd, lastUsd: usedUsd, monthKey: mk, startedAt: now };
    }
    return { ...session, lastUsd: Math.max(session.lastUsd || 0, usedUsd) };
  }

  function sessionSpendDelta(session) {
    if (!session || !Number.isFinite(session.baselineUsd) || !Number.isFinite(session.lastUsd)) return null;
    return Math.max(0, Number((session.lastUsd - session.baselineUsd).toFixed(2)));
  }

  // Daily store (chrome.storage.local):
  //   { days: { "2026-07-09": { startUsd, endUsd, monthKey } } }
  // startUsd chains from the previous observed sample in the same month, so
  // spend that happened while the browser was closed is attributed to the
  // first day it's observed again (approximate, and labeled as such).
  const MAX_SPEND_DAYS = 90;

  function applyDailySpendSample(store, sample, now = Date.now()) {
    const usedUsd = Number(sample?.usedUsd);
    if (!Number.isFinite(usedUsd)) return store || { days: {} };
    const next = { days: { ...(store?.days || {}) } };
    const dk = todayKey(new Date(now));
    const mk = monthKey(new Date(now));

    const entry = next.days[dk];
    if (!entry || entry.monthKey !== mk) {
      // First sample of the day: chain from the newest prior day in the same
      // month so overnight browser-closed spend still lands somewhere.
      const priorKeys = Object.keys(next.days)
        .filter(k => k < dk && next.days[k]?.monthKey === mk)
        .sort();
      const prior = priorKeys.length ? next.days[priorKeys[priorKeys.length - 1]] : null;
      let chained;
      if (prior && Number.isFinite(prior.endUsd)) {
        chained = Math.min(prior.endUsd, usedUsd);
      } else if (Object.keys(next.days).some(k => k < dk)) {
        // History exists but none from this month → the counter reset at the
        // month boundary, so everything on it is this month's spend; attribute
        // it to the first day it's observed (same convention as gaps).
        chained = 0;
      } else {
        // First sample ever (fresh install mid-month): the counter's current
        // value accumulated over unknown prior days — don't call it "today".
        chained = usedUsd;
      }
      next.days[dk] = { startUsd: chained, endUsd: usedUsd, monthKey: mk };
    } else if (usedUsd < (entry.endUsd || 0) - COUNTER_DROP_REANCHOR_USD) {
      // Counter genuinely dropped mid-day (credit adjustment) — re-anchor the
      // whole day rather than reporting negative or inflated spend. Smaller
      // dips are out-of-order samples and are absorbed by max() below.
      next.days[dk] = { startUsd: usedUsd, endUsd: usedUsd, monthKey: mk };
    } else {
      next.days[dk] = { ...entry, endUsd: Math.max(entry.endUsd || 0, usedUsd) };
    }

    const keys = Object.keys(next.days).sort();
    for (const key of keys.slice(0, Math.max(0, keys.length - MAX_SPEND_DAYS))) {
      delete next.days[key];
    }
    return next;
  }

  function daySpendUsd(store, dateKey = todayKey()) {
    const entry = store?.days?.[dateKey];
    if (!entry || !Number.isFinite(entry.startUsd) || !Number.isFinite(entry.endUsd)) return null;
    return Math.max(0, Number((entry.endUsd - entry.startUsd).toFixed(2)));
  }

  // Last `count` calendar days (oldest → newest, today last), zero-filled —
  // feeds the popup's trend bars. Real spend, not estimates.
  function spendDaysSeries(store, count = 14, now = new Date()) {
    const series = [];
    for (let i = count - 1; i >= 0; i -= 1) {
      const date = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
      const key = todayKey(date);
      series.push({ date: key, spendUsd: daySpendUsd(store, key) ?? 0 });
    }
    return series;
  }

  // CSV export: one row per observed day, newest first. Real dollars plus the
  // derived token range. No text, no prompts — same privacy posture as always.
  function spendDaysCsv(store, modelKey = DEFAULT_SETTINGS.defaultModel) {
    const header = "date,spend_usd,approx_tokens_low,approx_tokens_high";
    const days = store?.days || {};
    const lines = Object.keys(days)
      .sort()
      .reverse()
      .map(key => {
        const spend = daySpendUsd(store, key) ?? 0;
        const range = estimateTokenRangeFromSpend(spend, modelKey);
        return [key, spend.toFixed(2), range.low, range.high].join(",");
      });
    return [header, ...lines].join("\n");
  }

  // ---- Dollars → tokens conversion -----------------------------------------
  //
  // There is no exact answer here — a dollar of spend buys different token
  // counts depending on the input/output split and how much of the input was
  // served from prompt cache. So tokens are derived with a documented blended
  // price and shown as a RANGE, never a false-precision point value.
  //
  //   blended $/MTok = [ r·((1−c)·p_in + c·0.1·p_in) + p_out ] / (r + 1)
  //   tokens ≈ spend / blended price
  //
  // where r = input:output token ratio and c = fraction of input tokens
  // billed at the cache-read rate (0.1× input — Anthropic's published
  // multiplier, empirically confirmed to apply to claude.ai usage-credit
  // billing, which is billed at standard API rates).
  //
  // Constants: chat traffic re-sends conversation history every turn, so
  // input dominates. Short one-off chats run ~3:1 input:output; long
  // context-heavy work runs 12:1 or more (OpenRouter's 100T-token study puts
  // platform-wide averages near 15:1). r=6 is the blended midpoint; the
  // cache-hit fraction of billed input is unmeasured for claude.ai, so 0.3
  // is a soft assumption. Real-world error is roughly ±2×, which is exactly
  // why the UI shows the low–high range.
  const SPEND_TOKEN_MIX = {
    inputOutputRatio: 6,
    cacheReadFraction: 0.3
  };
  // Bounds used for the displayed range: fewest tokens per dollar (short
  // chats, nothing cached) to most tokens per dollar (long chats, half the
  // input served from cache).
  const SPEND_TOKEN_MIX_LOW = { inputOutputRatio: 3, cacheReadFraction: 0 };
  const SPEND_TOKEN_MIX_HIGH = { inputOutputRatio: 12, cacheReadFraction: 0.5 };
  const CACHE_READ_PRICE_FACTOR = 0.1;

  function blendedPricePerMTok(modelKey, mix = SPEND_TOKEN_MIX) {
    const model = MODEL_PRICES[resolveModelKey(modelKey)]
      || MODEL_PRICES[resolveModelKey(DEFAULT_SETTINGS.defaultModel)];
    const r = Math.max(0, Number(mix.inputOutputRatio) || 0);
    const c = clamp(Number(mix.cacheReadFraction) || 0, 0, 1);
    const effectiveInput = (1 - c) * model.inputPerMTok + c * model.inputPerMTok * CACHE_READ_PRICE_FACTOR;
    return (r * effectiveInput + model.outputPerMTok) / (r + 1);
  }

  function estimateTokensFromSpend(spendUsd, modelKey, mix = SPEND_TOKEN_MIX) {
    const spend = Number(spendUsd);
    if (!(spend > 0)) return 0;
    const price = blendedPricePerMTok(modelKey, mix);
    if (!(price > 0)) return 0;
    return Math.round((spend / price) * 1_000_000);
  }

  // The honest version: a low–high token range for a dollar figure.
  function estimateTokenRangeFromSpend(spendUsd, modelKey) {
    return {
      low: estimateTokensFromSpend(spendUsd, modelKey, SPEND_TOKEN_MIX_LOW),
      mid: estimateTokensFromSpend(spendUsd, modelKey, SPEND_TOKEN_MIX),
      high: estimateTokensFromSpend(spendUsd, modelKey, SPEND_TOKEN_MIX_HIGH)
    };
  }

  // Multi-model version for a daily by-model spend breakdown:
  // rows = [{ modelKey, spendUsd }] — each model converts at its own blend.
  function estimateTokensFromSpendRows(rows, mix = SPEND_TOKEN_MIX) {
    if (!Array.isArray(rows)) return 0;
    return rows.reduce((sum, row) => sum + estimateTokensFromSpend(row?.spendUsd, row?.modelKey, mix), 0);
  }

  // "≈1.2–2.8M tokens" — shares the magnitude suffix when both ends have the
  // same one, so the range reads compactly.
  function formatTokenRange(range) {
    const low = Number(range?.low || 0);
    const high = Number(range?.high || 0);
    if (!(high > 0)) return "≈0 tokens";
    const lowText = formatTokens(low);
    const highText = formatTokens(high);
    const suffix = (text) => (text.endsWith("M") || text.endsWith("k")) ? text.slice(-1) : "";
    if (suffix(lowText) && suffix(lowText) === suffix(highText)) {
      return `≈${lowText.slice(0, -1)}–${highText} tokens`;
    }
    return `≈${lowText}–${highText} tokens`;
  }

  // ---- Formatting / misc ----------------------------------------------------

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

  function formatUsd(value) {
    const amount = Number(value || 0);
    if (amount < 0.01 && amount > 0) return `$${amount.toFixed(4)}`;
    // Keep cents visible at every realistic magnitude — the UI promises the
    // figure is "accurate to the cent", so don't round it away at $10+.
    if (amount < 10_000) {
      const [whole, cents] = amount.toFixed(2).split(".");
      return `$${Number(whole).toLocaleString()}.${cents}`;
    }
    return `$${Math.round(amount).toLocaleString()}`;
  }

  function formatTokens(value) {
    const n = Number(value || 0);
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
    if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
    return String(Math.round(n));
  }

  // Ephemeral cross-tab state (the shared native-usage cache, pace samples,
  // session spend baseline) belongs in chrome.storage.session: memory-backed,
  // self-clearing on browser restart, and it doesn't hit disk once a minute.
  // Content scripts can only touch session storage after the background
  // grants access (setAccessLevel), so fall back to storage.local if session
  // isn't reachable yet — worst case is one redundant fetch, not lost data.
  async function ephemeralGet(keys) {
    try {
      return await chrome.storage.session.get(keys);
    } catch {
      try {
        return await chrome.storage.local.get(keys);
      } catch {
        return {};
      }
    }
  }

  async function ephemeralSet(items) {
    try {
      await chrome.storage.session.set(items);
    } catch {
      try {
        await chrome.storage.local.set(items);
      } catch {
        // Best-effort cache only.
      }
    }
  }

  function currentConversationId() {
    const path = location.pathname || "";
    const match = path.match(/chat\/([^/?#]+)/i) || path.match(/conversation\/([^/?#]+)/i);
    return match ? match[1] : "home-or-new-chat";
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

  // ---- Pace projection ("at this pace you'll hit your session limit…") ----
  //
  // Approach modeled on ccusage's burn-rate math and Claude-Code-Usage-
  // Monitor's trailing-window smoothing: a slope over a trailing window of
  // samples (never a jumpy two-point instantaneous delta), a minimum sample
  // count/time span before any prediction is made, and — the key rule — a
  // warning is only surfaced when the projected depletion lands BEFORE the
  // window's reset. If the reset comes first, the reset will save you, so
  // nothing alarming is shown.

  const PACE_TRAILING_WINDOW_MS = 45 * 60 * 1000;
  const PACE_MIN_SAMPLES = 3;
  const PACE_MIN_SPAN_MINUTES = 5;
  const PACE_MIN_SLOPE_PCT_PER_MIN = 0.05;

  // Append a new utilization sample to a ring buffer, detecting window
  // resets (utilization dropped) by clearing history so the new window's
  // pace isn't polluted by the old one's.
  function appendPaceSample(samples, sample, { maxSamples = 100, maxAgeMs = 90 * 60 * 1000 } = {}) {
    let next = Array.isArray(samples) ? samples.slice() : [];
    const last = next[next.length - 1];
    if (last) {
      if (sample.at <= last.at) return next; // duplicate/out-of-order poll
      if (sample.pct < last.pct - 0.5) next = []; // window reset — start fresh
    }
    next.push({ at: sample.at, pct: sample.pct });
    const cutoff = sample.at - maxAgeMs;
    next = next.filter(s => s.at >= cutoff);
    if (next.length > maxSamples) next = next.slice(-maxSamples);
    return next;
  }

  // Returns null (not enough signal), {kind:"safe"} (rising but the reset
  // arrives first), or {kind:"depletes", atMs} (on pace to hit the limit
  // before it resets — the only case worth alarming anyone about).
  function projectDepletion(samples, nowMs = Date.now(), resetsAtIso = null) {
    if (!Array.isArray(samples) || samples.length < PACE_MIN_SAMPLES) return null;
    const recent = samples.filter(s => nowMs - s.at <= PACE_TRAILING_WINDOW_MS);
    const usable = recent.length >= PACE_MIN_SAMPLES ? recent : samples;
    const first = usable[0];
    const last = usable[usable.length - 1];
    const spanMinutes = (last.at - first.at) / 60000;
    if (spanMinutes < PACE_MIN_SPAN_MINUTES) return null;

    const slope = (last.pct - first.pct) / spanMinutes; // pct per minute
    if (!(slope > PACE_MIN_SLOPE_PCT_PER_MIN)) return null; // steady — no prediction
    if (last.pct >= 100) return null; // already there; the bar says it all

    const minutesToLimit = (100 - last.pct) / slope;
    const depletesAtMs = last.at + minutesToLimit * 60000;
    const resetMs = Date.parse(resetsAtIso || "");
    if (!Number.isNaN(resetMs) && depletesAtMs >= resetMs) {
      return { kind: "safe" };
    }
    return { kind: "depletes", atMs: depletesAtMs };
  }

  // "3:45 PM" with a day-relative prefix when it isn't today — a glance
  // answers "is this today?" without date math (pattern borrowed from
  // Claude-Code-Usage-Monitor's prediction labels).
  function formatClockTime(ms, now = new Date()) {
    const when = new Date(ms);
    const time = when.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    const sameDay = when.getFullYear() === now.getFullYear()
      && when.getMonth() === now.getMonth()
      && when.getDate() === now.getDate();
    if (sameDay) return time;
    const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    const isTomorrow = when.getFullYear() === tomorrow.getFullYear()
      && when.getMonth() === tomorrow.getMonth()
      && when.getDate() === tomorrow.getDate();
    return isTomorrow ? `tomorrow ${time}` : `${when.toLocaleDateString()} ${time}`;
  }

  function paceWarningText(projection, now = new Date()) {
    if (!projection || projection.kind !== "depletes") return null;
    return `At this pace, you'll hit your session limit around ${formatClockTime(projection.atMs, now)} (estimated).`;
  }

  globalThis.ClaudeUsageCompanion = {
    MODEL_PRICES,
    DEFAULT_SETTINGS,
    SPEND_TOKEN_MIX,
    SPEND_TOKEN_MIX_LOW,
    SPEND_TOKEN_MIX_HIGH,
    mergeSettings,
    anyNativeLimitPrefVisible,
    resolveModelKey,
    applySessionSpendSample,
    sessionSpendDelta,
    applyDailySpendSample,
    daySpendUsd,
    spendDaysSeries,
    spendDaysCsv,
    blendedPricePerMTok,
    estimateTokensFromSpend,
    estimateTokenRangeFromSpend,
    estimateTokensFromSpendRows,
    formatTokenRange,
    formatUsd,
    formatTokens,
    ephemeralGet,
    ephemeralSet,
    currentConversationId,
    detectModelFromText,
    detectModelFromId,
    todayKey,
    monthKey,
    clamp,
    appendPaceSample,
    projectDepletion,
    paceWarningText
  };
})();
