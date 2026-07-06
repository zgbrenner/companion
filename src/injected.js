(() => {
  if (window.__CLAUDE_USAGE_COMPANION_INSTALLED__) return;
  window.__CLAUDE_USAGE_COMPANION_INSTALLED__ = true;

  const EVENT_NAME = "cuc:network-event";
  const USAGE_EVENT_NAME = "cuc:usage-snapshot";

  function emit(detail) {
    window.dispatchEvent(new CustomEvent(EVENT_NAME, { detail }));
  }

  function emitUsage(detail) {
    window.dispatchEvent(new CustomEvent(USAGE_EVENT_NAME, { detail }));
  }

  function maybeParseJson(value) {
    try {
      return JSON.parse(value);
    } catch {
      return null;
    }
  }

  function extractTextFromObject(obj) {
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

  function extractTextFromChunk(raw) {
    const text = String(raw || "");
    const lines = text.split(/\r?\n/);
    const pieces = [];

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed === "data: [DONE]") continue;

      if (trimmed.startsWith("data:")) {
        const payload = trimmed.slice(5).trim();
        const parsed = maybeParseJson(payload);
        if (parsed) pieces.push(extractTextFromObject(parsed));
        continue;
      }

      const parsed = maybeParseJson(trimmed);
      if (parsed) pieces.push(extractTextFromObject(parsed));
    }

    return pieces.join(" ").replace(/\s+/g, " ").trim();
  }

  function isClaudeConversationUrl(url) {
    const value = String(url || "");
    return /claude\.ai/i.test(value) && /api|completion|message|chat|conversation|usage/i.test(value);
  }

  async function readStreamClone(response, requestUrl) {
    if (!response || !response.body) return;
    const contentType = response.headers?.get?.("content-type") || "";
    if (!/event-stream|json|text/i.test(contentType)) return;

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let totalText = "";
    let rawBytes = 0;

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        rawBytes += value?.byteLength || 0;
        const chunk = decoder.decode(value, { stream: true });
        const extracted = extractTextFromChunk(chunk);
        if (extracted) {
          totalText += " " + extracted;
          emit({
            kind: "response-chunk",
            url: requestUrl,
            extractedChars: extracted.length,
            rawBytes,
            at: Date.now()
          });
        }
      }
    } catch (error) {
      emit({ kind: "stream-read-error", url: requestUrl, message: String(error?.message || error), at: Date.now() });
    } finally {
      const clean = totalText.replace(/\s+/g, " ").trim();
      if (clean) {
        emit({ kind: "response-complete", url: requestUrl, textSampleLength: clean.length, text: clean, rawBytes, at: Date.now() });
      }
    }
  }

  const originalFetch = window.fetch;
  window.fetch = async function patchedFetch(input, init) {
    const requestUrl = typeof input === "string" ? input : input?.url;
    const requestMethod = init?.method || input?.method || "GET";

    if (isClaudeConversationUrl(requestUrl)) {
      emit({ kind: "request", url: requestUrl, method: requestMethod, at: Date.now() });
    }

    const response = await originalFetch.apply(this, arguments);

    if (isClaudeConversationUrl(requestUrl)) {
      emit({ kind: "response", url: requestUrl, status: response.status, at: Date.now() });

      const lowerUrl = String(requestUrl || "").toLowerCase();
      if (lowerUrl.includes("usage")) {
        response.clone().json().then(json => {
          emitUsage({ kind: "usage-endpoint", url: requestUrl, payload: json, at: Date.now() });
        }).catch(() => {});
      }

      if (/completion|message|chat|conversation/i.test(String(requestUrl || ""))) {
        readStreamClone(response.clone(), requestUrl);
      }
    }

    return response;
  };

  emit({ kind: "installed", at: Date.now() });
})();
