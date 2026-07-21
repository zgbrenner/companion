// Runs in ChatGPT's MAIN world at document_start. It observes only first-party
// OpenAI traffic and emits bounded normalized numeric usage snapshots through
// one-time secret event channels. Raw account JSON, prompt text, response text,
// file bodies, authentication material, and URL query strings never cross the
// bridge.
(() => {
  if (window.__COMPANION_OPENAI_INSTALLED__) return;
  window.__COMPANION_OPENAI_INSTALLED__ = true;

  const MAILBOX_ID = "cuc-openai-channel-mailbox";
  const STATE_ATTRIBUTE = "data-companion-openai-bridge";
  const MAX_PENDING = 50;
  const MAX_JSON_BYTES = 2_000_000;
  const MAX_DEPTH = 7;
  const MAX_VISITED = 500;
  const nativeDispatch = window.dispatchEvent.bind(window);
  const CustomEventCtor = globalThis.CustomEvent;
  let channel = null;
  let pending = [];
  let requestCounter = 0;
  let mailboxObserver = null;

  function markState(value) {
    try { document.documentElement?.setAttribute(STATE_ATTRIBUTE, value); }
    catch { /* diagnostics must never affect the page */ }
  }

  function validChannel(value) {
    return typeof value === "string"
      && value.length >= 8
      && value.length <= 200
      && /^[A-Za-z0-9_-]+$/.test(value);
  }

  function connectMailbox() {
    if (channel) return true;
    const mailbox = document.getElementById(MAILBOX_ID);
    const channelId = mailbox?.getAttribute?.("data-channel");
    if (!validChannel(channelId)) return false;
    channel = {
      usage: `cuc:openai-usage:${channelId}`,
      network: `cuc:openai-network:${channelId}`,
    };
    try { mailbox.remove(); } catch { /* best effort */ }
    mailboxObserver?.disconnect?.();
    mailboxObserver = null;
    markState("ready");
    const queued = pending;
    pending = [];
    for (const item of queued) dispatch(item.kind, item.detail);
    return true;
  }

  function watchForMailbox() {
    if (connectMailbox()) return;
    const target = document.documentElement || document;
    mailboxObserver = new MutationObserver(connectMailbox);
    mailboxObserver.observe(target, { childList: true, subtree: true });
    queueMicrotask(connectMailbox);
  }

  function dispatch(kind, detail) {
    if (!channel) {
      if (pending.length < MAX_PENDING) pending.push({ kind, detail });
      return;
    }
    let serialized;
    try { serialized = JSON.stringify(detail); }
    catch { return; }
    if (serialized.length > 2_100_000) return;
    nativeDispatch(new CustomEventCtor(channel[kind], { detail: serialized }));
  }

  watchForMailbox();

  function canonical(value) {
    return String(value || "")
      .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
      .replace(/[^A-Za-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .toLowerCase();
  }

  function numeric(value) {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && /^\s*\d+(?:\.\d+)?\s*$/.test(value)) return Number(value);
    return null;
  }

  function firstNumber(entries, aliases) {
    for (const [rawKey, value] of entries) {
      const key = canonical(rawKey);
      if (!aliases.has(key)) continue;
      const number = numeric(value);
      if (number != null) return { key, value: number };
    }
    return null;
  }

  function firstString(entries, aliases) {
    for (const [rawKey, value] of entries) {
      if (!aliases.has(canonical(rawKey)) || typeof value !== "string") continue;
      const text = value.trim();
      if (text && text.length <= 160) return text;
    }
    return null;
  }

  const USED = new Set(["used", "usage", "consumed", "spent", "amount_used", "usage_used", "used_credits", "credits_used", "credit_used", "used_tokens", "tokens_used", "used_messages", "messages_used", "used_usd", "usd_used", "cost_used"]);
  const LIMIT = new Set(["limit", "quota", "allowance", "total", "maximum", "max", "usage_limit", "credit_limit", "credits_limit", "total_credits", "token_limit", "tokens_limit", "message_limit", "messages_limit", "usd_limit", "budget", "budget_usd"]);
  const PCT = new Set(["pct", "percent", "percentage", "utilization", "utilisation", "usage_percent", "used_percent", "percent_used", "utilization_pct", "utilisation_pct", "usage_pct", "ratio", "fraction"]);
  const RESET = new Set(["reset_at", "resets_at", "reset_time", "resets_time", "reset_date", "resets_date", "next_reset_at", "window_end", "period_end", "expires_at"]);
  const NAME = new Set(["name", "label", "type", "window", "bucket", "period", "product"]);

  function bucketFor(text) {
    const key = canonical(text);
    if (/(?:agentic|workspace_agent|workspace_agents|codex|work_usage|work_credit)/.test(key)) return { key: "agentic", label: "Agentic usage" };
    if (/(?:five_hour|5_hour|5h|session|primary_window|short_window)/.test(key)) return { key: "five-hour", label: "Session limit" };
    if (/(?:daily|one_day|1_day|24_hour|24h)/.test(key)) return { key: "daily", label: "Daily limit" };
    if (/(?:seven_day|7_day|7d|weekly|week|secondary_window|long_window)/.test(key)) return { key: "seven-day", label: "Weekly limit" };
    if (/(?:monthly|month|billing_period)/.test(key)) return { key: "monthly", label: "Monthly allowance" };
    return null;
  }

  function unitFor(text) {
    const key = canonical(text);
    if (/(?:credit|agentic)/.test(key)) return "credits";
    if (/(?:usd|dollar|cost|spend|budget)/.test(key)) return "usd";
    if (/token/.test(key)) return "tokens";
    if (/(?:message|request|task|run)/.test(key)) return "messages";
    return null;
  }

  function resetValue(value) {
    if (typeof value !== "string" || value.length > 160) return null;
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
  }

  function percentage(value, key) {
    if (!Number.isFinite(value) || value < 0) return null;
    let pct = value;
    if (pct <= 1 && !/(?:pct|percent|percentage)/.test(canonical(key))) pct *= 100;
    return pct <= 1000 ? Number(pct.toFixed(4)) : null;
  }

  function normalizeUsage(payload, sourcePath) {
    if (!payload || typeof payload !== "object") return null;
    const buckets = new Map();
    const counters = {};
    let visited = 0;
    let tokenInput = null;
    let tokenOutput = null;
    let tokenTotal = null;

    function keepCounter(unit, used, limit, resetsAt) {
      if (!unit || used == null || !Number.isFinite(used) || used < 0) return;
      const safeLimit = Number.isFinite(limit) && limit > 0 ? limit : null;
      const candidate = { used, limit: safeLimit, resetsAt: resetsAt || null };
      const existing = counters[unit];
      const score = item => (item?.limit != null ? 2 : 1) + (item?.resetsAt ? 1 : 0);
      if (!existing || score(candidate) > score(existing)) counters[unit] = candidate;
    }

    function walk(node, path, depth) {
      if (!node || typeof node !== "object" || depth > MAX_DEPTH || visited >= MAX_VISITED) return;
      visited += 1;
      if (Array.isArray(node)) {
        for (let index = 0; index < Math.min(node.length, 100); index += 1) walk(node[index], path.concat(String(index)), depth + 1);
        return;
      }
      const entries = Object.entries(node).slice(0, 150);
      const contextParts = path.slice(-3);
      const name = firstString(entries, NAME);
      if (name) contextParts.push(name);
      const context = contextParts.join("_");
      const bucket = bucketFor(context);
      const used = firstNumber(entries, USED);
      const limit = firstNumber(entries, LIMIT);
      const pctEntry = firstNumber(entries, PCT);
      const reset = resetValue(firstString(entries, RESET));
      const unit = unitFor(`${context}_${used?.key || ""}_${limit?.key || ""}`);
      let pct = pctEntry ? percentage(pctEntry.value, pctEntry.key) : null;
      if (pct == null && used && limit?.value > 0) pct = percentage((used.value / limit.value) * 100, "percent");
      if (used) keepCounter(unit, used.value, limit?.value, reset);
      if (bucket && pct != null) {
        const candidate = { key: bucket.key, label: bucket.label, pct, resetsAt: reset, used: used?.value ?? null, limit: limit?.value ?? null, unit };
        const existing = buckets.get(bucket.key);
        const score = item => (item?.used != null ? 2 : 0) + (item?.limit != null ? 2 : 0) + (item?.resetsAt ? 1 : 0) + (item?.unit ? 1 : 0);
        if (!existing || score(candidate) > score(existing)) buckets.set(bucket.key, candidate);
      }
      for (const [rawKey, rawValue] of entries) {
        const key = canonical(rawKey);
        const number = numeric(rawValue);
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
      counters.tokens = { input: tokenInput, output: tokenOutput, total: tokenTotal ?? ((tokenInput ?? 0) + (tokenOutput ?? 0)) };
    }
    const normalizedBuckets = Array.from(buckets.values());
    if (!normalizedBuckets.length && !Object.keys(counters).length) return null;
    return {
      provider: "openai",
      observedAt: Date.now(),
      sourcePath,
      buckets: normalizedBuckets,
      counters,
      maxUtilizationPct: normalizedBuckets.length ? Math.max(...normalizedBuckets.map(item => item.pct)) : null,
    };
  }

  function parseUrl(value) {
    try { return new URL(typeof value === "string" ? value : value?.url, location.href); }
    catch { return null; }
  }

  function isOpenAIUrl(value) {
    const url = parseUrl(value);
    if (!url || url.protocol !== "https:") return false;
    const host = url.hostname.toLowerCase();
    return host === "chatgpt.com" || host.endsWith(".chatgpt.com") || host === "chat.openai.com";
  }

  function isUsageLikeUrl(value) {
    const url = parseUrl(value);
    if (!url || !isOpenAIUrl(url)) return false;
    const target = `${url.pathname}${url.search}`;
    return /usage|limits?|quota|credits?|billing|subscription|rate[_-]?limits?|agentic[_-]?(?:usage|credits?)/i.test(target);
  }

  function safePath(value) {
    const url = parseUrl(value);
    return url && isOpenAIUrl(url) ? url.pathname.slice(0, 240) : null;
  }

  function contentLengthAllowed(response) {
    const raw = response?.headers?.get?.("content-length");
    if (!raw) return true;
    const length = Number(raw);
    return Number.isFinite(length) && length >= 0 && length <= MAX_JSON_BYTES;
  }

  function safeModelHeader(response) {
    for (const name of ["x-openai-model", "x-model", "openai-model"]) {
      const value = response?.headers?.get?.(name);
      if (typeof value === "string" && /^[A-Za-z0-9._:-]{2,120}$/.test(value)) return value;
    }
    return null;
  }

  function emitNormalizedUsage(payload, sourcePath) {
    const snapshot = normalizeUsage(payload, sourcePath);
    if (snapshot) dispatch("usage", { snapshot });
  }

  async function inspectUsageResponse(response, requestUrl) {
    if (!response || !contentLengthAllowed(response)) return;
    const contentType = response.headers?.get?.("content-type") || "";
    if (!/json/i.test(contentType)) return;
    try {
      const text = await response.text();
      if (text.length > MAX_JSON_BYTES) return;
      emitNormalizedUsage(JSON.parse(text), safePath(requestUrl));
    } catch { /* changed or unreadable response shape */ }
  }

  function scanUsageFrame(line, sourcePath) {
    const trimmed = String(line || "").trim();
    if (!trimmed.startsWith("data:")) return;
    const body = trimmed.slice(5).trim();
    if (!body || body === "[DONE]" || body.length > 100_000 || !/usage|limit|quota|credit|token/i.test(body)) return;
    try { emitNormalizedUsage(JSON.parse(body), sourcePath); } catch { /* ordinary frame */ }
  }

  async function watchGeneration(response, requestUrl, requestId) {
    const sourcePath = safePath(requestUrl);
    if (!response?.body) {
      dispatch("network", { kind: "generation-complete", requestId, sourcePath, at: Date.now() });
      return;
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let carry = "";
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (value) {
          carry += decoder.decode(value, { stream: !done });
          const lines = carry.split(/\r?\n/);
          carry = lines.pop() || "";
          for (const line of lines) scanUsageFrame(line, sourcePath);
          if (carry.length > 120_000) carry = carry.slice(-120_000);
        }
        if (done) break;
      }
      if (carry) scanUsageFrame(carry, sourcePath);
    } catch { /* cancelled stream */ }
    finally { dispatch("network", { kind: "generation-complete", requestId, sourcePath, at: Date.now() }); }
  }

  const originalFetch = window.fetch;
  if (typeof originalFetch === "function") {
    window.fetch = async function companionOpenAIFetch(input, init) {
      const requestUrl = typeof input === "string" ? input : input?.url;
      const method = String(init?.method || input?.method || "GET").toUpperCase();
      const response = await originalFetch.apply(this, arguments);
      if (!isOpenAIUrl(requestUrl)) return response;
      if (isUsageLikeUrl(requestUrl)) inspectUsageResponse(response.clone(), requestUrl);
      const modelId = safeModelHeader(response);
      if (modelId) dispatch("network", { kind: "model-detected", modelId, sourcePath: safePath(requestUrl), at: Date.now() });
      const contentType = response.headers?.get?.("content-type") || "";
      if (method === "POST" && /event-stream/i.test(contentType)) {
        requestCounter += 1;
        const requestId = `${Date.now()}-${requestCounter}-${Math.random().toString(36).slice(2, 10)}`;
        dispatch("network", { kind: "generation-start", requestId, sourcePath: safePath(requestUrl), at: Date.now() });
        watchGeneration(response.clone(), requestUrl, requestId);
      }
      return response;
    };
  }

  function readXhrJson(xhr) {
    const responseType = String(xhr?.responseType || "");
    if (responseType === "json") return xhr.response && typeof xhr.response === "object" ? xhr.response : null;
    if (responseType && responseType !== "text") return null;
    let text;
    try { text = xhr.responseText; } catch { return null; }
    if (typeof text !== "string" || text.length > MAX_JSON_BYTES) return null;
    try { return JSON.parse(text); } catch { return null; }
  }

  const XHR = globalThis.XMLHttpRequest;
  if (XHR?.prototype) {
    const xhrMeta = new WeakMap();
    const originalOpen = XHR.prototype.open;
    const originalSend = XHR.prototype.send;
    XHR.prototype.open = function companionOpenAIXhrOpen(method, url, ...rest) {
      xhrMeta.set(this, { method: String(method || "GET").toUpperCase(), url: String(url || "") });
      return originalOpen.call(this, method, url, ...rest);
    };
    XHR.prototype.send = function companionOpenAIXhrSend(...args) {
      const meta = xhrMeta.get(this);
      if (meta && isOpenAIUrl(meta.url)) {
        this.addEventListener("load", () => {
          let contentType = "";
          try { contentType = this.getResponseHeader?.("content-type") || ""; } catch { /* unreadable headers */ }
          if (isUsageLikeUrl(meta.url) && /json/i.test(contentType)) {
            const payload = readXhrJson(this);
            if (payload) emitNormalizedUsage(payload, safePath(meta.url));
          }
          if (meta.method === "POST" && /event-stream/i.test(contentType)) {
            requestCounter += 1;
            dispatch("network", { kind: "generation-complete", requestId: `xhr-${Date.now()}-${requestCounter}`, sourcePath: safePath(meta.url), at: Date.now() });
          }
        }, { once: true });
      }
      return originalSend.apply(this, args);
    };
  }
})();
