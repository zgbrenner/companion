// Runs in the page's MAIN world as a manifest-declared content script at
// document_start — Chrome guarantees this executes BEFORE any of claude.ai's
// own scripts, so window.fetch/XMLHttpRequest are patched before the app can
// capture private references to them.
//
// v0.8.0: this watcher no longer reads any prompt or response TEXT. All
// dollar/token figures now come from Claude's own usage-credit counter; the
// only things observed here are:
//   • which model a generation request used (for the footer + token blend)
//   • when a generation finishes (so the counter is re-read right away)
//   • live message_limit frames (sanitized utilization only)
//   • claude.ai touching its own usage endpoints (refresh nudge)
(() => {
  if (window.__CLAUDE_USAGE_COMPANION_INSTALLED__) return;
  window.__CLAUDE_USAGE_COMPANION_INSTALLED__ = true;

  const EVENT_NAME = "cuc:network-event";
  const USAGE_EVENT_NAME = "cuc:usage-snapshot";
  const DEBUG_PREFIX = "[Claude Companion]";

  // Handshake token minted by the ISOLATED-world content script and offered
  // via a "cuc:token-offer" DOM event. Every event we emit carries it, and
  // the content script drops events without it — so another page-world script
  // can't forge events and corrupt the numbers.
  //
  // Ordering safety: both content scripts run at document_start, before ANY
  // page script executes, so the FIRST token offer seen here is guaranteed to
  // come from our own extension. The handshake is two-way because Chrome
  // doesn't guarantee which world's content script runs first: if the
  // isolated script ran before us, its first offer went nowhere, so we
  // announce "cuc:main-ready" and it re-offers.
  let AUTH_TOKEN = null;
  let pendingEvents = [];
  const MAX_PENDING_EVENTS = 50;

  function dispatch(name, detail) {
    window.dispatchEvent(new CustomEvent(name, { detail: { ...detail, token: AUTH_TOKEN } }));
  }

  function emitNamed(name, detail) {
    if (!AUTH_TOKEN) {
      if (pendingEvents.length < MAX_PENDING_EVENTS) pendingEvents.push({ name, detail });
      return;
    }
    dispatch(name, detail);
  }

  const emit = (detail) => emitNamed(EVENT_NAME, detail);
  const emitUsage = (detail) => emitNamed(USAGE_EVENT_NAME, detail);

  window.addEventListener("cuc:token-offer", event => {
    if (AUTH_TOKEN) return; // first offer wins
    const token = event?.detail?.token;
    if (!token || typeof token !== "string") return;
    AUTH_TOKEN = token;
    const queued = pendingEvents;
    pendingEvents = [];
    for (const item of queued) dispatch(item.name, item.detail);
  });
  window.dispatchEvent(new CustomEvent("cuc:main-ready"));

  function maybeParseJson(value) {
    try {
      return JSON.parse(value);
    } catch {
      return null;
    }
  }

  // Real origin check, not a substring test. A substring match on "claude.ai"
  // would treat a third-party URL that merely embeds that string as
  // same-origin and inspect it.
  function isClaudeOrigin(url) {
    try {
      const host = new URL(url, location.href).hostname.toLowerCase();
      return host === "claude.ai" || host.endsWith(".claude.ai");
    } catch {
      return false;
    }
  }

  function isUsageUrl(url) {
    return /\/usage(\b|\/|\?|#|$)/i.test(String(url || ""));
  }

  // Endpoints that look like claude.ai's own usage/spend reporting (the data
  // behind Settings → Usage). When the app itself calls one, forward the PATH
  // only — the content script probes it with its own credentialed fetch and
  // learns the real breakdown endpoint even if claude.ai renames it.
  function isSpendReportUrl(url) {
    try {
      const path = new URL(url, location.href).pathname;
      if (!/\/api\//.test(path)) return false;
      return /usage|spend|billing|credit|cost/i.test(path);
    } catch {
      return false;
    }
  }

  function extractConversationId(url) {
    try {
      const path = new URL(url, location.href).pathname;
      const match = path.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
      return match ? match[0] : null;
    } catch {
      return null;
    }
  }

  function findModelId(obj) {
    if (!obj || typeof obj !== "object") return "";
    const visit = (node, depth = 0) => {
      if (!node || depth > 5) return "";
      if (typeof node === "string") return "";
      if (Array.isArray(node)) {
        for (const child of node) {
          const found = visit(child, depth + 1);
          if (found) return found;
        }
        return "";
      }
      if (typeof node !== "object") return "";

      for (const key of ["model", "model_id", "modelId", "selected_model"]) {
        const value = node[key];
        if (typeof value === "string" && value.length < 120) return value;
      }
      for (const key of Object.keys(node)) {
        const found = visit(node[key], depth + 1);
        if (found) return found;
      }
      return "";
    };
    return visit(obj);
  }

  async function parseRequestJson(input, init) {
    const body = init?.body;
    if (typeof body === "string") return maybeParseJson(body);
    if (body instanceof URLSearchParams) return maybeParseJson(body.toString());
    try {
      if (input instanceof Request) {
        // Don't clone non-JSON bodies: cloning tees the body stream, so
        // reading the clone of a large multipart file upload would buffer the
        // whole file a second time for nothing.
        const contentType = input.headers?.get?.("content-type") || "";
        if (contentType && !/json/i.test(contentType)) return null;
        return await input.clone().json();
      }
    } catch {
      // Not JSON or already consumed; best-effort only.
    }
    return null;
  }

  // Claude's generation streams carry their own `message_limit` frames (the
  // same data the /usage endpoint reports, but pushed live). We forward only
  // a sanitized {bucket: {utilizationPct, resetsAt}} snapshot — never the raw
  // payload — plus a nudge for the content script to re-read the usage
  // endpoint through its own credentialed fetch, throttled so a chatty
  // stream doesn't spam the bus.
  let lastMessageLimitEmitAt = 0;
  function notifyMessageLimit(payload) {
    const now = Date.now();
    if (now - lastMessageLimitEmitAt < 5000) return;
    lastMessageLimitEmitAt = now;
    emitUsage({ kind: "message-limit", at: now, buckets: sanitizeMessageLimitBuckets(payload) });
  }

  // Defensive extraction: the message_limit frame shape is undocumented, so
  // pull out ONLY numeric utilization + reset timestamps for the known
  // rolling-limit buckets, wherever they sit in the object. Anything else in
  // the payload stays in the page world.
  function sanitizeMessageLimitBuckets(payload) {
    const bucketMap = { five_hour: "fiveHour", seven_day: "sevenDay", seven_day_opus: "sevenDayOpus" };
    const found = {};
    const visit = (node, depth) => {
      if (!node || typeof node !== "object" || depth > 5) return;
      if (Array.isArray(node)) {
        for (const child of node) visit(child, depth + 1);
        return;
      }
      for (const [key, value] of Object.entries(node)) {
        const mapped = bucketMap[key];
        if (mapped && value && typeof value === "object" && typeof value.utilization === "number") {
          found[mapped] = {
            utilizationPct: value.utilization,
            resetsAt: typeof value.resets_at === "string" ? value.resets_at : null
          };
        } else if (value && typeof value === "object") {
          visit(value, depth + 1);
        }
      }
    };
    visit(payload, 0);
    return Object.keys(found).length ? found : null;
  }

  // Scan an SSE body chunk-by-chunk ONLY for message_limit frames. No
  // response text is extracted or accumulated anywhere.
  function scanChunkForMessageLimit(chunk) {
    const lines = String(chunk || "").split(/\r?\n/);
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) continue;
      if (!/message_limit/.test(trimmed)) continue;
      const parsed = maybeParseJson(trimmed.slice(5).trim());
      if (parsed && (parsed.type === "message_limit" || parsed.message_limit)) {
        notifyMessageLimit(parsed);
      }
    }
  }

  let nextRequestCounter = 0;
  function createRequestId() {
    nextRequestCounter += 1;
    return `${Date.now()}-${nextRequestCounter}-${Math.random().toString(36).slice(2, 10)}`;
  }

  // Drain a cloned generation stream: watch for message_limit frames, and
  // signal completion so the content script re-reads Claude's usage counter
  // right after the response lands. SSE frames can split across chunks; a
  // message_limit frame torn across a boundary is simply missed (the polling
  // path still covers it), which is an acceptable trade for never buffering
  // response text.
  async function watchStreamClone(response, requestInfo) {
    if (!response || !response.body) return;
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (value) scanChunkForMessageLimit(decoder.decode(value, { stream: !done }));
        if (done) break;
      }
    } catch {
      // A dropped stream still ends the generation; fall through to complete.
    } finally {
      emit({
        kind: "generation-complete",
        requestId: requestInfo.requestId,
        conversationId: requestInfo.conversationId,
        modelId: requestInfo.modelId,
        at: Date.now()
      });
    }
  }

  const originalFetch = window.fetch;
  window.fetch = async function patchedFetch(input, init) {
    const requestUrl = typeof input === "string" ? input : input?.url;
    const isClaude = isClaudeOrigin(requestUrl);
    const requestMethod = String(init?.method || input?.method || "GET").toUpperCase();

    // Capture the request body BEFORE the real fetch runs: a Request object's
    // body is consumed by the fetch itself, so cloning it afterwards throws.
    let requestJsonPromise = null;
    if (isClaude && requestMethod === "POST") {
      requestJsonPromise = parseRequestJson(input, init).catch(() => null);
    }

    const response = await originalFetch.apply(this, arguments);

    // Only ever inspect first-party claude.ai responses.
    if (!isClaude) return response;

    // Usage/spend endpoints: signal that fresh usage data appeared (and which
    // path served it) so the content script can re-read via its own
    // credentialed fetch. We deliberately do NOT forward the payload —
    // broadcasting raw account JSON onto the page-global event bus would
    // expose it to any other script on the page.
    if (isUsageUrl(requestUrl)) {
      emitUsage({ kind: "usage-endpoint", at: Date.now() });
    } else if (requestMethod === "GET" && isSpendReportUrl(requestUrl)) {
      try {
        emitUsage({ kind: "spend-report-endpoint", path: new URL(requestUrl, location.href).pathname, at: Date.now() });
      } catch {
        // Path parse failed — skip the hint.
      }
    }

    // A claude.ai POST answered with an event-stream response is a live
    // generation. History loads, lists, and feature flags are GET and/or
    // plain JSON, so they can't be mistaken for one.
    if (requestJsonPromise) {
      const contentType = response.headers?.get?.("content-type") || "";
      if (/event-stream/i.test(contentType)) {
        const requestJson = await requestJsonPromise;
        const requestInfo = {
          requestId: createRequestId(),
          conversationId: extractConversationId(requestUrl),
          modelId: findModelId(requestJson) || null
        };
        if (requestInfo.modelId) {
          emit({
            kind: "model-detected",
            requestId: requestInfo.requestId,
            conversationId: requestInfo.conversationId,
            modelId: requestInfo.modelId,
            at: Date.now()
          });
        }
        watchStreamClone(response.clone(), requestInfo);
      }
    }

    return response;
  };

  // Some client builds stream over XMLHttpRequest instead of fetch; cover
  // that path too (model detection + completion signal + message_limit scan
  // over the final text, once, at load time).
  const xhrMeta = new WeakMap();
  const originalXhrOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function patchedOpen(method, url, ...rest) {
    try {
      xhrMeta.set(this, { method: String(method || "GET").toUpperCase(), url: String(url || "") });
    } catch {
      // Never let bookkeeping break the app's own requests.
    }
    return originalXhrOpen.call(this, method, url, ...rest);
  };

  const originalXhrSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.send = function patchedSend(body) {
    const meta = xhrMeta.get(this);
    if (meta && isClaudeOrigin(meta.url)) {
      const requestJson = meta.method === "POST" && typeof body === "string" ? maybeParseJson(body) : null;
      this.addEventListener("load", () => {
        try {
          if (meta.method === "GET") {
            if (isUsageUrl(meta.url)) emitUsage({ kind: "usage-endpoint", at: Date.now() });
            else if (isSpendReportUrl(meta.url)) {
              emitUsage({ kind: "spend-report-endpoint", path: new URL(meta.url, location.href).pathname, at: Date.now() });
            }
            return;
          }
          if (meta.method !== "POST") return;
          const contentType = this.getResponseHeader("content-type") || "";
          if (!/event-stream/i.test(contentType)) return;
          if (!this.responseType || this.responseType === "text") {
            scanChunkForMessageLimit(this.responseText);
          }
          const modelId = findModelId(requestJson) || null;
          const requestInfo = {
            requestId: createRequestId(),
            conversationId: extractConversationId(meta.url),
            modelId
          };
          if (modelId) {
            emit({ kind: "model-detected", requestId: requestInfo.requestId, conversationId: requestInfo.conversationId, modelId, at: Date.now() });
          }
          emit({ kind: "generation-complete", requestId: requestInfo.requestId, conversationId: requestInfo.conversationId, modelId, at: Date.now() });
        } catch {
          try { console.debug(DEBUG_PREFIX, "xhr watch error (ignored)"); } catch {}
        }
      });
    }
    return originalXhrSend.call(this, body);
  };
})();
