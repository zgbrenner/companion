// Runs in ChatGPT's MAIN world at document_start. It observes only first-party
// OpenAI traffic and emits bounded normalized numeric usage snapshots. Raw
// account JSON, prompt text, response text, and file bodies never cross the
// page event bridge.
(() => {
  if (window.__COMPANION_OPENAI_INSTALLED__) return;
  window.__COMPANION_OPENAI_INSTALLED__ = true;

  const PLATFORM = globalThis.CompanionPlatform;
  const NETWORK_EVENT = "cuc:openai-network-event";
  const USAGE_EVENT = "cuc:openai-usage-snapshot";
  const TOKEN_OFFER = "cuc:openai-token-offer";
  const MAIN_READY = "cuc:openai-main-ready";
  const MAX_PENDING = 50;
  const MAX_JSON_BYTES = 2_000_000;
  let authToken = null;
  let pending = [];
  let requestCounter = 0;

  function dispatch(name, detail) {
    window.dispatchEvent(new CustomEvent(name, { detail: { ...detail, token: authToken } }));
  }

  function emit(name, detail) {
    if (!authToken) {
      if (pending.length < MAX_PENDING) pending.push({ name, detail });
      return;
    }
    dispatch(name, detail);
  }

  window.addEventListener(TOKEN_OFFER, event => {
    if (authToken) return;
    const token = event?.detail?.token;
    if (typeof token !== "string" || token.length < 8 || token.length > 200) return;
    authToken = token;
    const queued = pending;
    pending = [];
    for (const item of queued) dispatch(item.name, item.detail);
  });
  window.dispatchEvent(new CustomEvent(MAIN_READY));

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
    return /usage|limit|quota|credit|billing|subscription|agentic|codex|workspace|account/i.test(`${url.pathname}${url.search}`);
  }

  function safePath(value) {
    const url = parseUrl(value);
    return url && isOpenAIUrl(url) ? `${url.pathname}${url.search}`.slice(0, 240) : null;
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
    const snapshot = PLATFORM?.normalizeOpenAIUsage?.(payload, { sourcePath, observedAt: Date.now() });
    if (!snapshot) return;
    emit(USAGE_EVENT, { snapshot });
  }

  async function inspectUsageResponse(response, requestUrl) {
    if (!response || !contentLengthAllowed(response)) return;
    const contentType = response.headers?.get?.("content-type") || "";
    if (!/json/i.test(contentType)) return;
    try {
      const text = await response.text();
      if (text.length > MAX_JSON_BYTES) return;
      emitNormalizedUsage(JSON.parse(text), safePath(requestUrl));
    } catch {
      // Undocumented response shapes are best effort and never affect ChatGPT.
    }
  }

  function scanUsageFrame(line, sourcePath) {
    const trimmed = String(line || "").trim();
    if (!trimmed.startsWith("data:")) return;
    const body = trimmed.slice(5).trim();
    if (!body || body === "[DONE]" || body.length > 100_000) return;
    if (!/usage|limit|quota|credit|token/i.test(body)) return;
    try { emitNormalizedUsage(JSON.parse(body), sourcePath); }
    catch { /* ordinary generation frames are not usage JSON */ }
  }

  async function watchGeneration(response, requestUrl, requestId) {
    if (!response?.body) {
      emit(NETWORK_EVENT, { kind: "generation-complete", requestId, sourcePath: safePath(requestUrl), at: Date.now() });
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
          for (const line of lines) scanUsageFrame(line, safePath(requestUrl));
          if (carry.length > 120_000) carry = carry.slice(-120_000);
        }
        if (done) break;
      }
      if (carry) scanUsageFrame(carry, safePath(requestUrl));
    } catch {
      // A cancelled stream is still a completed request from the meter's view.
    } finally {
      emit(NETWORK_EVENT, { kind: "generation-complete", requestId, sourcePath: safePath(requestUrl), at: Date.now() });
    }
  }

  const originalFetch = window.fetch;
  if (typeof originalFetch === "function") {
    window.fetch = async function companionOpenAIFetch(input, init) {
      const requestUrl = typeof input === "string" ? input : input?.url;
      const method = String(init?.method || input?.method || "GET").toUpperCase();
      const firstParty = isOpenAIUrl(requestUrl);
      const response = await originalFetch.apply(this, arguments);
      if (!firstParty) return response;

      if (isUsageLikeUrl(requestUrl)) inspectUsageResponse(response.clone(), requestUrl);

      const modelId = safeModelHeader(response);
      if (modelId) {
        emit(NETWORK_EVENT, { kind: "model-detected", modelId, sourcePath: safePath(requestUrl), at: Date.now() });
      }

      const contentType = response.headers?.get?.("content-type") || "";
      if (method === "POST" && /event-stream/i.test(contentType)) {
        requestCounter += 1;
        const requestId = `${Date.now()}-${requestCounter}-${Math.random().toString(36).slice(2, 10)}`;
        emit(NETWORK_EVENT, { kind: "generation-start", requestId, sourcePath: safePath(requestUrl), at: Date.now() });
        watchGeneration(response.clone(), requestUrl, requestId);
      }
      return response;
    };
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
          const contentType = this.getResponseHeader?.("content-type") || "";
          if (isUsageLikeUrl(meta.url) && /json/i.test(contentType) && typeof this.responseText === "string" && this.responseText.length <= MAX_JSON_BYTES) {
            try { emitNormalizedUsage(JSON.parse(this.responseText), safePath(meta.url)); }
            catch { /* non-JSON or changed shape */ }
          }
          if (meta.method === "POST" && /event-stream/i.test(contentType)) {
            requestCounter += 1;
            emit(NETWORK_EVENT, {
              kind: "generation-complete",
              requestId: `xhr-${Date.now()}-${requestCounter}`,
              sourcePath: safePath(meta.url),
              at: Date.now(),
            });
          }
        }, { once: true });
      }
      return originalSend.apply(this, args);
    };
  }
})();
