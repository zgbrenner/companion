// Runs in the page's MAIN world as a manifest-declared content script at
// document_start — Chrome guarantees this executes BEFORE any of claude.ai's
// own scripts, so window.fetch/XMLHttpRequest are patched before the app can
// capture private references to them. (The previous <script src> injection
// loaded asynchronously, so the app's bundle could — and did — grab the
// original fetch first, after which no generation stream was ever observed
// and output tokens silently stopped being tracked.)
(() => {
  if (window.__CLAUDE_USAGE_COMPANION_INSTALLED__) return;
  window.__CLAUDE_USAGE_COMPANION_INSTALLED__ = true;

  const EVENT_NAME = "cuc:network-event";
  const USAGE_EVENT_NAME = "cuc:usage-snapshot";
  const DEBUG_PREFIX = "[Claude Companion]";

  // Handshake token minted by the ISOLATED-world content script and offered
  // via a "cuc:token-offer" DOM event. Every event we emit carries it, and
  // the content script drops events without it — so another page-world script
  // can't forge usage events and silently corrupt the numbers.
  //
  // Ordering safety: both content scripts run at document_start, before ANY
  // page script executes, so the FIRST token offer seen here is guaranteed to
  // come from our own extension — a malicious page script can't get its offer
  // in first. The handshake is two-way because Chrome doesn't guarantee which
  // world's content script runs first: if the isolated script ran before us,
  // its first offer went nowhere, so we announce "cuc:main-ready" and it
  // re-offers.
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

  function maybeParseJson(value) {
    try {
      return JSON.parse(value);
    } catch {
      return null;
    }
  }

  function extractTextFallback(obj) {
    if (!obj || typeof obj !== "object") return "";

    const pieces = [];
    const visit = (node, depth = 0) => {
      if (!node || depth > 6) return;
      if (typeof node === "string") return;
      if (Array.isArray(node)) {
        node.forEach(child => visit(child, depth + 1));
        return;
      }
      if (typeof node !== "object") return;

      const candidateKeys = [
        "text",
        "completion",
        "delta",
        "message",
        "content",
        "answer",
        "thinking"
      ];

      for (const key of candidateKeys) {
        const value = node[key];
        if (typeof value === "string" && value.length > 0 && value.length < 100000) {
          pieces.push(value);
        }
      }

      for (const key of Object.keys(node)) {
        if (["id", "uuid", "created_at", "updated_at", "model", "stop_reason", "type", "index"].includes(key)) continue;
        visit(node[key], depth + 1);
      }
    };
    visit(obj);
    return pieces.join(" ");
  }

  function extractTextFromObject(obj) {
    if (!obj || typeof obj !== "object") return { text: "", isDelta: false };

    if (obj.type === "content_block_delta") {
      const delta = obj.delta;
      if (delta?.type === "text_delta" && typeof delta.text === "string") {
        return { text: delta.text, isDelta: true };
      }
      if (delta?.type === "thinking_delta" && typeof delta.thinking === "string") {
        return { text: delta.thinking, isDelta: true };
      }
      return { text: "", isDelta: true };
    }

    if (obj.type === "completion" && typeof obj.completion === "string") {
      return { text: obj.completion, isDelta: true };
    }

    if ([
      "message_start",
      "message_stop",
      "message_delta",
      "content_block_start"
    ].includes(obj.type)) {
      return { text: "", isDelta: true };
    }

    return { text: extractTextFallback(obj), isDelta: false };
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
      if (input instanceof Request) return await input.clone().json();
    } catch {
      // Not JSON or already consumed; best-effort only.
    }
    return null;
  }

  function findNextDataBoundary(text) {
    const match = /\r?\ndata:/i.exec(text.slice(1));
    if (!match) return null;
    return { index: 1 + match.index, length: match[0].startsWith("\r\n") ? 2 : 1 };
  }

  function findFrameBoundary(text) {
    const blank = /\r?\n\r?\n/.exec(text);
    const nextData = findNextDataBoundary(text);
    if (!blank) return nextData;
    const blankBoundary = { index: blank.index, length: blank[0].length };
    if (!nextData || blankBoundary.index <= nextData.index) return blankBoundary;
    return nextData;
  }

  function extractTextFromFrame(rawFrame) {
    const lines = String(rawFrame || "").split(/\r?\n/);
    const pieces = [];
    let sawDataLine = false;

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      if (trimmed.startsWith("data:")) {
        sawDataLine = true;
        const payload = trimmed.slice(5).trim();
        if (!payload || payload === "[DONE]") continue;
        const parsed = maybeParseJson(payload);
        if (parsed) {
          if (parsed.type === "message_limit" || parsed.message_limit) notifyMessageLimit(parsed);
          pieces.push(extractTextFromObject(parsed));
        }
        continue;
      }

      if (!sawDataLine) {
        const parsed = maybeParseJson(trimmed);
        if (parsed) {
          if (parsed.type === "message_limit" || parsed.message_limit) notifyMessageLimit(parsed);
          pieces.push(extractTextFromObject(parsed));
        }
      }
    }

    return pieces.filter(piece => piece.text);
  }

  function extractTextFromChunk(raw, buffer = "", flush = false) {
    let text = `${buffer || ""}${String(raw || "")}`;
    const pieces = [];

    while (text) {
      const boundary = findFrameBoundary(text);
      if (!boundary) {
        if (flush) {
          pieces.push(...extractTextFromFrame(text));
          text = "";
        }
        break;
      }

      pieces.push(...extractTextFromFrame(text.slice(0, boundary.index)));
      text = text.slice(boundary.index + boundary.length);
    }

    return { pieces, remainder: text };
  }

  // Real origin check, not a substring test. A substring match on "claude.ai"
  // would treat a third-party URL that merely embeds that string (a referrer
  // echoed in a query param, a redirect target) as same-origin and read its body.
  function isClaudeOrigin(url) {
    try {
      const host = new URL(url, location.href).hostname.toLowerCase();
      return host === "claude.ai" || host.endsWith(".claude.ai");
    } catch {
      return false;
    }
  }

  // Known generation-shaped paths. This is a CLASSIFIER now, not a gate: the
  // actual gate is "claude.ai POST whose response is an event stream" — that
  // combination is a live generation, and gating on this URL regex alone is
  // exactly what broke output tracking when claude.ai's paths drifted. When a
  // POST+SSE stream does NOT match this pattern we still count it, and log a
  // debug line so the drift is visible instead of silent.
  function isKnownGenerationUrl(url) {
    return /(completion|append_message|retry_completion|\/stream)/i.test(String(url || ""));
  }

  function isUsageUrl(url) {
    return /\/usage(\b|\/|\?|#|$)/i.test(String(url || ""));
  }

  // Overall ceiling on accumulated stream text so a pathologically long
  // response can't grow totalText without bound before it's shipped and tokenized.
  const MAX_STREAM_CHARS = 200000;

  function appendWithoutRepeating(existing, next) {
    const cleanNext = String(next || "").replace(/\s+/g, " ").trim();
    if (!cleanNext) return existing;
    const cleanExisting = String(existing || "").replace(/\s+/g, " ").trim();
    if (!cleanExisting) return cleanNext;
    if (cleanNext.startsWith(cleanExisting)) return cleanNext;
    if (cleanExisting.endsWith(cleanNext)) return cleanExisting;

    const maxOverlap = Math.min(cleanExisting.length, cleanNext.length, 2000);
    for (let size = maxOverlap; size >= 20; size -= 1) {
      if (cleanExisting.slice(-size) === cleanNext.slice(0, size)) {
        return `${cleanExisting}${cleanNext.slice(size)}`;
      }
    }
    return `${cleanExisting} ${cleanNext}`;
  }

  function appendExtractedText(existing, extracted) {
    const cleanNext = String(extracted?.text || "").replace(/\s+/g, " ").trim();
    if (!cleanNext) return existing;
    if (!String(existing || "").trim()) return cleanNext;
    if (extracted.isDelta) return `${existing} ${cleanNext}`;
    return appendWithoutRepeating(existing, cleanNext);
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

  let nextRequestCounter = 0;
  function createRequestId() {
    nextRequestCounter += 1;
    return `${Date.now()}-${nextRequestCounter}-${Math.random().toString(36).slice(2, 10)}`;
  }

  function emitGenerationStart(requestInfo, promptChars) {
    emit({
      kind: "generation-start",
      requestId: requestInfo.requestId,
      conversationId: requestInfo.conversationId,
      modelId: requestInfo.modelId,
      promptChars,
      at: Date.now()
    });
    if (requestInfo.modelId) {
      emit({
        kind: "model-detected",
        requestId: requestInfo.requestId,
        conversationId: requestInfo.conversationId,
        modelId: requestInfo.modelId,
        at: Date.now()
      });
    }
  }

  function emitResponseComplete(requestInfo, totalText) {
    const clean = String(totalText || "").replace(/\s+/g, " ").trim();
    if (!clean) return;
    // We emit only the assistant text needed to count output tokens, and only
    // for genuine generation streams. No per-chunk events, no raw bytes —
    // minimize what crosses onto the page-global event bus.
    emit({
      kind: "response-complete",
      requestId: requestInfo.requestId,
      conversationId: requestInfo.conversationId,
      modelId: requestInfo.modelId,
      textLength: clean.length,
      text: clean,
      at: Date.now()
    });
  }

  async function readStreamClone(response, requestInfo) {
    if (!response || !response.body) return;

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let totalText = "";
    let pendingText = "";
    let capped = false;

    try {
      while (true) {
        const { done, value } = await reader.read();
        const chunk = done ? decoder.decode() : decoder.decode(value, { stream: true });
        const extracted = extractTextFromChunk(chunk, pendingText, done);
        pendingText = extracted.remainder;

        for (const piece of extracted.pieces) {
          if (!piece.text || capped) continue;
          totalText = appendExtractedText(totalText, piece);
          if (totalText.length >= MAX_STREAM_CHARS) {
            totalText = totalText.slice(0, MAX_STREAM_CHARS);
            capped = true;
            break;
          }
        }
        if (done) break;
      }
    } catch {
      // Swallow read errors: a partial output count is better than none, and we
      // deliberately avoid emitting error detail that could echo request info.
    } finally {
      emitResponseComplete(requestInfo, totalText);
    }
  }

  // Length (in characters) of the user prompt inside a generation request
  // body, for send events the DOM listeners can't see (Retry, edit-and-resend,
  // slash-command sends). Only the LENGTH crosses the event bus — never the
  // prompt text itself.
  function findPromptChars(obj) {
    if (!obj || typeof obj !== "object") return 0;
    if (typeof obj.prompt === "string") return obj.prompt.length;
    const visit = (node, depth = 0) => {
      if (!node || depth > 4) return 0;
      if (Array.isArray(node)) {
        for (const child of node) {
          const found = visit(child, depth + 1);
          if (found) return found;
        }
        return 0;
      }
      if (typeof node !== "object") return 0;
      if (typeof node.prompt === "string") return node.prompt.length;
      for (const key of Object.keys(node)) {
        const found = visit(node[key], depth + 1);
        if (found) return found;
      }
      return 0;
    };
    return visit(obj);
  }

  const originalFetch = window.fetch;
  window.fetch = async function patchedFetch(input, init) {
    const requestUrl = typeof input === "string" ? input : input?.url;
    const isClaude = isClaudeOrigin(requestUrl);
    const requestMethod = String(init?.method || input?.method || "GET").toUpperCase();

    // Capture the request body BEFORE the real fetch runs: a Request object's
    // body is consumed by the fetch itself, so cloning it afterwards throws.
    // Captured for EVERY claude.ai POST (not just known generation URLs)
    // because the event-stream gate below can only be evaluated after the
    // response headers arrive; non-JSON bodies (file uploads etc.) resolve to
    // null cheaply.
    let requestJsonPromise = null;
    if (isClaude && requestMethod === "POST") {
      requestJsonPromise = parseRequestJson(input, init).catch(() => null);
    }

    const response = await originalFetch.apply(this, arguments);

    // Only ever inspect first-party claude.ai responses.
    if (!isClaude) return response;

    // Usage endpoint: signal only that fresh usage data appeared, so the content
    // script can re-read it via its own credentialed fetch. We deliberately do
    // NOT forward the payload — broadcasting raw account JSON onto the
    // page-global event bus would expose it to any other script on the page.
    if (isUsageUrl(requestUrl)) {
      emitUsage({ kind: "usage-endpoint", at: Date.now() });
    }

    // Assistant generation stream: a claude.ai POST answered with an actual
    // event-stream response. History loads, lists, and feature flags are GET
    // and/or plain JSON, so they can't be mistaken for a new response.
    if (requestJsonPromise) {
      const contentType = response.headers?.get?.("content-type") || "";
      if (/event-stream/i.test(contentType)) {
        if (!isKnownGenerationUrl(requestUrl)) {
          // Path drifted from the known patterns — still counted, but leave a
          // breadcrumb for diagnosing future changes from DevTools.
          try { console.debug(DEBUG_PREFIX, "counting unrecognized generation stream:", new URL(requestUrl, location.href).pathname); } catch {}
        }
        const requestJson = await requestJsonPromise;
        const requestInfo = {
          requestId: createRequestId(),
          conversationId: extractConversationId(requestUrl),
          modelId: findModelId(requestJson) || null
        };
        emitGenerationStart(requestInfo, findPromptChars(requestJson));
        readStreamClone(response.clone(), requestInfo);
      }
    }

    return response;
  };

  // Some client builds stream over XMLHttpRequest instead of fetch; cover that
  // path too. The full response text is parsed once at load time (no
  // per-chunk work), through the same frame extractor as the fetch path.
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
    if (meta && meta.method === "POST" && isClaudeOrigin(meta.url)) {
      const requestJson = typeof body === "string" ? maybeParseJson(body) : null;
      this.addEventListener("load", () => {
        try {
          const contentType = this.getResponseHeader("content-type") || "";
          if (!/event-stream/i.test(contentType)) {
            if (isUsageUrl(meta.url)) emitUsage({ kind: "usage-endpoint", at: Date.now() });
            return;
          }
          if (this.responseType && this.responseType !== "text") return;
          if (!isKnownGenerationUrl(meta.url)) {
            try { console.debug(DEBUG_PREFIX, "counting unrecognized XHR generation stream:", new URL(meta.url, location.href).pathname); } catch {}
          }
          const requestInfo = {
            requestId: createRequestId(),
            conversationId: extractConversationId(meta.url),
            modelId: findModelId(requestJson) || null
          };
          emitGenerationStart(requestInfo, findPromptChars(requestJson));
          const extracted = extractTextFromChunk(this.responseText, "", true);
          let totalText = "";
          for (const piece of extracted.pieces) {
            if (!piece.text) continue;
            totalText = appendExtractedText(totalText, piece);
            if (totalText.length >= MAX_STREAM_CHARS) {
              totalText = totalText.slice(0, MAX_STREAM_CHARS);
              break;
            }
          }
          emitResponseComplete(requestInfo, totalText);
        } catch {
          // Counting must never interfere with the page's own handling.
        }
      });
    }
    return originalXhrSend.call(this, body);
  };
})();
