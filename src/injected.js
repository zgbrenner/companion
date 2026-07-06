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

  async function readStreamClone(response, requestUrl) {
    if (!response || !response.body) return;

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let totalText = "";
    let capped = false;

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        const extracted = extractTextFromChunk(chunk);
        if (extracted && !capped) {
          totalText += " " + extracted;
          if (totalText.length >= MAX_STREAM_CHARS) {
            totalText = totalText.slice(0, MAX_STREAM_CHARS);
            capped = true;
          }
        }
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
        emit({ kind: "response-complete", textLength: clean.length, text: clean, at: Date.now() });
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
      const contentType = response.headers?.get?.("content-type") || "";
      if (/event-stream/i.test(contentType)) {
        readStreamClone(response.clone(), requestUrl);
      }
    }

    return response;
  };
})();
