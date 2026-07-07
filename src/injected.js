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
        if (parsed) pieces.push(extractTextFromObject(parsed));
        continue;
      }

      if (!sawDataLine) {
        const parsed = maybeParseJson(trimmed);
        if (parsed) pieces.push(extractTextFromObject(parsed));
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

  // A live assistant *generation* stream, as opposed to loading an existing
  // conversation's history/list JSON. Matching chat/conversation/message broadly
  // meant that opening or switching to an existing chat replayed its stored
  // messages as brand-new "output", spiking tokens and dollars with no
  // generation. We additionally require POST + an event-stream content-type
  // below, so this is only the first gate.
  function isGenerationUrl(url) {
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
      const clean = totalText.replace(/\s+/g, " ").trim();
      if (clean) {
        // We emit only the assistant text needed to count output tokens, and
        // only for genuine generation streams (gated by the caller). No
        // per-chunk events, no raw bytes — minimize what crosses onto the
        // page-global event bus.
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
    }
  }

  const originalFetch = window.fetch;
  window.fetch = async function patchedFetch(input, init) {
    const requestUrl = typeof input === "string" ? input : input?.url;
    const response = await originalFetch.apply(this, arguments);

    // Only ever inspect first-party claude.ai responses.
    if (!isClaudeOrigin(requestUrl)) return response;

    const requestMethod = String(init?.method || input?.method || "GET").toUpperCase();

    // Usage endpoint: signal only that fresh usage data appeared, so the content
    // script can re-read it via its own credentialed fetch. We deliberately do
    // NOT forward the payload — broadcasting raw account JSON onto the
    // page-global event bus would expose it to any other script on the page.
    if (isUsageUrl(requestUrl)) {
      emitUsage({ kind: "usage-endpoint", at: Date.now() });
    }

    // Assistant generation stream only: POST, a generation-shaped path, and an
    // actual event-stream response. This is the sole path that produces
    // "output" token counts; anything else (history, lists, feature flags) is
    // ignored so it can't be mistaken for a new response.
    if (requestMethod === "POST" && isGenerationUrl(requestUrl)) {
      const requestJson = await parseRequestJson(input, init);
      const requestModel = findModelId(requestJson) || null;

      const contentType = response.headers?.get?.("content-type") || "";
      if (/event-stream/i.test(contentType)) {
        const requestInfo = {
          requestId: createRequestId(),
          conversationId: extractConversationId(requestUrl),
          modelId: requestModel
        };
        emit({
          kind: "generation-start",
          requestId: requestInfo.requestId,
          conversationId: requestInfo.conversationId,
          modelId: requestInfo.modelId,
          at: Date.now()
        });
        if (requestModel) {
          emit({
            kind: "model-detected",
            requestId: requestInfo.requestId,
            conversationId: requestInfo.conversationId,
            modelId: requestModel,
            at: Date.now()
          });
        }
        readStreamClone(response.clone(), requestInfo);
      }
    }

    return response;
  };
})();
