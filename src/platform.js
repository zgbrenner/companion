(() => {
  const OPENAI_HOSTS = new Set(["chatgpt.com", "chat.openai.com"]);
  const CLAUDE_HOSTS = new Set(["claude.ai"]);
  const MAX_DEPTH = 7;
  const MAX_VISITED_NODES = 500;

  function parseUrl(input) {
    try {
      if (input instanceof URL) return input;
      const value = typeof input === "string" ? input : input?.href;
      return new URL(String(value || ""));
    } catch {
      return null;
    }
  }

  function hostMatches(hostname, roots) {
    const host = String(hostname || "").toLowerCase();
    for (const root of roots) {
      if (host === root || host.endsWith(`.${root}`)) return true;
    }
    return false;
  }

  function detectProvider(input) {
    const url = parseUrl(input);
    if (!url || url.protocol !== "https:") return null;
    if (hostMatches(url.hostname, CLAUDE_HOSTS)) return "claude";
    if (hostMatches(url.hostname, OPENAI_HOSTS)) return "openai";
    return null;
  }

  function detectSurface({ url, selectedModeText = "" } = {}) {
    const parsed = parseUrl(url);
    const provider = detectProvider(parsed);
    if (provider === "claude") return "claude";
    if (provider !== "openai") return null;

    const selected = String(selectedModeText || "").trim().toLowerCase();
    if (/^codex(?:\b|\s)/.test(selected)) return "codex";
    if (/^work(?:\b|\s)/.test(selected)) return "work";
    if (/^chat(?:gpt)?(?:\b|\s)/.test(selected)) return "chat";

    const path = parsed.pathname.toLowerCase();
    const mode = ["mode", "surface", "view"]
      .map(key => parsed.searchParams.get(key))
      .find(Boolean)?.toLowerCase();
    if (mode === "codex" || /(^|\/)codex(?:\/|$)/.test(path)) return "codex";
    if (mode === "work" || /(^|\/)work(?:\/|$)/.test(path)) return "work";
    return "chat";
  }

  function conversationIdFromUrl(input) {
    const url = parseUrl(input);
    if (!url) return null;
    const patterns = [
      /\/c\/([^/?#]+)/i,
      /\/chat\/([^/?#]+)/i,
      /\/conversation\/([^/?#]+)/i,
      /\/codex\/(?:tasks?|sessions?|chats?)\/([^/?#]+)/i,
    ];
    for (const pattern of patterns) {
      const match = url.pathname.match(pattern);
      if (!match) continue;
      let value = match[1];
      try { value = decodeURIComponent(value); } catch { /* keep encoded */ }
      if (/^[A-Za-z0-9_-]{8,128}$/.test(value)) return value;
    }
    return null;
  }

  function canonicalKey(value) {
    return String(value || "")
      .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
      .replace(/[^A-Za-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .toLowerCase();
  }

  function finiteNumber(value) {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && value.trim() && /^-?\d+(?:\.\d+)?$/.test(value.trim())) {
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : null;
    }
    return null;
  }

  function firstNumber(entries, aliases) {
    for (const [rawKey, value] of entries) {
      const key = canonicalKey(rawKey);
      if (!aliases.has(key)) continue;
      const number = finiteNumber(value);
      if (number != null) return { key, value: number };
    }
    return null;
  }

  function firstString(entries, aliases) {
    for (const [rawKey, value] of entries) {
      const key = canonicalKey(rawKey);
      if (!aliases.has(key) || typeof value !== "string") continue;
      const trimmed = value.trim();
      if (trimmed && trimmed.length <= 160) return { key, value: trimmed };
    }
    return null;
  }

  const USED_KEYS = new Set([
    "used", "usage", "consumed", "spent", "amount_used", "usage_used",
    "used_credits", "credits_used", "credit_used", "used_tokens", "tokens_used",
    "used_messages", "messages_used", "used_usd", "usd_used", "cost_used",
  ]);
  const LIMIT_KEYS = new Set([
    "limit", "quota", "allowance", "total", "maximum", "max", "usage_limit",
    "credit_limit", "credits_limit", "total_credits", "token_limit", "tokens_limit",
    "message_limit", "messages_limit", "usd_limit", "budget", "budget_usd",
  ]);
  const PCT_KEYS = new Set([
    "pct", "percent", "percentage", "utilization", "utilisation", "usage_percent",
    "used_percent", "percent_used", "utilization_pct", "utilisation_pct", "usage_pct",
    "ratio", "fraction",
  ]);
  const RESET_KEYS = new Set([
    "reset_at", "resets_at", "reset_time", "resets_time", "reset_date", "resets_date",
    "next_reset_at", "window_end", "period_end", "expires_at",
  ]);
  const NAME_KEYS = new Set(["name", "label", "type", "window", "bucket", "period", "product"]);

  function normalizePct(number, sourceKey) {
    if (!Number.isFinite(number) || number < 0) return null;
    const key = canonicalKey(sourceKey);
    let value = number;
    if (value <= 1 && !/(?:pct|percent|percentage)/.test(key)) value *= 100;
    if (value > 1000) return null;
    return Number(value.toFixed(4));
  }

  function parseReset(value) {
    if (typeof value !== "string" || value.length > 160) return null;
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
  }

  function classifyBucket(text) {
    const key = canonicalKey(text);
    if (!key) return null;
    if (/(?:agentic|workspace_agent|workspace_agents|codex|work_usage|work_credit)/.test(key)) {
      return { key: "agentic", label: "Agentic usage" };
    }
    if (/(?:five_hour|5_hour|5h|session|primary_window|short_window)/.test(key)) {
      return { key: "five-hour", label: "Session limit" };
    }
    if (/(?:daily|one_day|1_day|24_hour|24h)/.test(key)) {
      return { key: "daily", label: "Daily limit" };
    }
    if (/(?:seven_day|7_day|7d|weekly|week|secondary_window|long_window)/.test(key)) {
      return { key: "seven-day", label: "Weekly limit" };
    }
    if (/(?:monthly|month|billing_period)/.test(key)) {
      return { key: "monthly", label: "Monthly allowance" };
    }
    return null;
  }

  function classifyUnit(text) {
    const key = canonicalKey(text);
    if (/(?:credit|agentic)/.test(key)) return "credits";
    if (/(?:usd|dollar|cost|spend|budget)/.test(key)) return "usd";
    if (/(?:token)/.test(key)) return "tokens";
    if (/(?:message|request|task|run)/.test(key)) return "messages";
    return null;
  }

  function betterBucket(existing, candidate) {
    if (!existing) return candidate;
    const score = bucket =>
      (bucket.used != null ? 2 : 0)
      + (bucket.limit != null ? 2 : 0)
      + (bucket.resetsAt ? 1 : 0)
      + (bucket.unit ? 1 : 0);
    return score(candidate) > score(existing) ? candidate : existing;
  }

  function normalizeOpenAIUsage(payload, { sourcePath = null, observedAt = Date.now() } = {}) {
    if (!payload || typeof payload !== "object") return null;

    const bucketsByKey = new Map();
    const counters = {};
    let visited = 0;
    let tokenInput = null;
    let tokenOutput = null;
    let tokenTotal = null;

    function setCounter(unit, used, limit, resetsAt) {
      if (!unit || used == null) return;
      if (!Number.isFinite(used) || used < 0) return;
      if (limit != null && (!Number.isFinite(limit) || limit <= 0)) limit = null;
      const current = counters[unit];
      const candidate = { used, limit, resetsAt: resetsAt || null };
      const currentScore = current ? (current.limit != null ? 2 : 1) + (current.resetsAt ? 1 : 0) : -1;
      const candidateScore = (candidate.limit != null ? 2 : 1) + (candidate.resetsAt ? 1 : 0);
      if (!current || candidateScore > currentScore) counters[unit] = candidate;
    }

    function walk(node, path, depth) {
      if (!node || typeof node !== "object" || depth > MAX_DEPTH || visited >= MAX_VISITED_NODES) return;
      visited += 1;
      if (Array.isArray(node)) {
        for (let i = 0; i < Math.min(node.length, 100); i += 1) walk(node[i], path.concat(String(i)), depth + 1);
        return;
      }

      const entries = Object.entries(node).slice(0, 150);
      const contextTextParts = path.slice(-3);
      const name = firstString(entries, NAME_KEYS);
      if (name) contextTextParts.push(name.value);
      const contextText = contextTextParts.join("_");
      const bucketMeta = classifyBucket(contextText);

      const used = firstNumber(entries, USED_KEYS);
      const limit = firstNumber(entries, LIMIT_KEYS);
      const pctEntry = firstNumber(entries, PCT_KEYS);
      const resetEntry = firstString(entries, RESET_KEYS);
      const resetsAt = parseReset(resetEntry?.value);
      const unit = classifyUnit(`${contextText}_${used?.key || ""}_${limit?.key || ""}`);

      let pct = pctEntry ? normalizePct(pctEntry.value, pctEntry.key) : null;
      if (pct == null && used && limit && limit.value > 0) pct = normalizePct((used.value / limit.value) * 100, "percent");

      if (used) setCounter(unit, used.value, limit?.value ?? null, resetsAt);
      if (bucketMeta && pct != null) {
        const candidate = {
          key: bucketMeta.key,
          label: bucketMeta.label,
          pct,
          resetsAt,
          used: used?.value ?? null,
          limit: limit?.value ?? null,
          unit,
        };
        bucketsByKey.set(bucketMeta.key, betterBucket(bucketsByKey.get(bucketMeta.key), candidate));
      }

      for (const [rawKey, rawValue] of entries) {
        const key = canonicalKey(rawKey);
        const number = finiteNumber(rawValue);
        if (number != null && number >= 0) {
          if (["input_tokens", "prompt_tokens", "tokens_input"].includes(key)) tokenInput = Math.max(tokenInput ?? 0, number);
          if (["output_tokens", "completion_tokens", "tokens_output"].includes(key)) tokenOutput = Math.max(tokenOutput ?? 0, number);
          if (["total_tokens", "tokens_total"].includes(key)) tokenTotal = Math.max(tokenTotal ?? 0, number);
        }
        if (rawValue && typeof rawValue === "object") walk(rawValue, path.concat(key), depth + 1);
      }
    }

    walk(payload, [], 0);

    if (tokenInput != null || tokenOutput != null || tokenTotal != null) {
      counters.tokens = {
        input: tokenInput,
        output: tokenOutput,
        total: tokenTotal ?? ((tokenInput ?? 0) + (tokenOutput ?? 0)),
      };
    }

    const buckets = Array.from(bucketsByKey.values());
    if (!buckets.length && !Object.keys(counters).length) return null;

    return {
      provider: "openai",
      observedAt: Number.isFinite(observedAt) ? observedAt : Date.now(),
      sourcePath: typeof sourcePath === "string" && sourcePath.length <= 240 ? sourcePath : null,
      buckets,
      counters,
      maxUtilizationPct: buckets.length ? Math.max(...buckets.map(bucket => bucket.pct)) : null,
    };
  }

  const SURFACE_META = Object.freeze({
    claude: Object.freeze({ label: "Claude", tone: "claude" }),
    chat: Object.freeze({ label: "Chat", tone: "chat" }),
    work: Object.freeze({ label: "Work", tone: "work" }),
    codex: Object.freeze({ label: "Codex", tone: "codex" }),
  });

  globalThis.CompanionPlatform = Object.freeze({
    detectProvider,
    detectSurface,
    conversationIdFromUrl,
    normalizeOpenAIUsage,
    surfaceMeta(surface) {
      return SURFACE_META[surface] || SURFACE_META.chat;
    },
  });
})();
