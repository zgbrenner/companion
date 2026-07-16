// Offscreen conversion service — the privileged relay (see offscreen.html for
// why this split exists). Receives {type:"cuc:offscreen-convert", dataUrl, ext}
// from the background router, hands the raw bytes to the sandboxed iframe for
// parsing, and replies {ok, markdown}. The file's bytes never leave the
// machine, and the parser never sees a chrome API.

const SANDBOX_TIMEOUT_MS = 60_000;
const SANDBOX_READY_TIMEOUT_MS = 10_000;
const pending = new Map(); // id -> {resolve, reject, timer}

// Decode a data: URL to bytes WITHOUT fetch(): the extension-pages CSP has no
// data: source in connect-src, so fetch(dataUrl) is blocked outright.
// FileReader.readAsDataURL (the producer, in content.js) always emits base64.
function dataUrlToArrayBuffer(dataUrl) {
  const comma = dataUrl.indexOf(",");
  if (comma < 0) throw new Error("malformed data URL");
  const meta = dataUrl.slice(0, comma);
  const payload = dataUrl.slice(comma + 1);
  if (!/;base64$/i.test(meta)) {
    return new TextEncoder().encode(decodeURIComponent(payload)).buffer;
  }
  const binary = atob(payload);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

function sandboxFrame() {
  return document.getElementById("sandbox");
}

// Set up the ready gate EAGERLY at module load, resolving on the iframe's
// load event OR the sandbox's ready message — whichever comes first — so we
// can never miss an already-fired signal and hang.
let resolveSandboxReady;
let sandboxIsReady = false;
const sandboxReady = new Promise(resolve => {
  resolveSandboxReady = () => { sandboxIsReady = true; resolve(); };
});
// Bounded wait: if the sandbox iframe never signals ready (load failure,
// future CSP change), fail the conversion instead of hanging the caller's
// sendMessage — and with it the dropzone's "Converting…" label — forever.
function whenSandboxReady() {
  if (sandboxIsReady) return sandboxReady;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("file converter failed to start — try reloading the extension")),
      SANDBOX_READY_TIMEOUT_MS
    );
    sandboxReady.then(() => { clearTimeout(timer); resolve(); });
  });
}
(function armReadyFallback() {
  const frame = sandboxFrame();
  if (!frame) { requestAnimationFrame(armReadyFallback); return; }
  frame.addEventListener("load", () => resolveSandboxReady(), { once: true });
  // If the iframe already finished loading before this ran, don't wait.
  try { if (frame.contentDocument?.readyState === "complete") resolveSandboxReady(); } catch { /* opaque origin — the load/message paths cover it */ }
})();

window.addEventListener("message", event => {
  const message = event.data;
  if (!message || typeof message !== "object") return;
  // Only accept messages from our own sandbox iframe's window.
  if (event.source !== sandboxFrame()?.contentWindow) return;

  if (message.type === "cuc:sandbox-ready") {
    resolveSandboxReady();
    return;
  }
  if (message.type === "cuc:sandbox-result" && typeof message.id === "string") {
    const entry = pending.get(message.id);
    if (!entry) return;
    clearTimeout(entry.timer);
    pending.delete(message.id);
    if (message.ok) entry.resolve(String(message.markdown || ""));
    else entry.reject(new Error(message.error || "conversion failed"));
  }
});

let convertCounter = 0;
function runInSandbox(bytes, ext, workerSource) {
  const id = `${Date.now()}-${convertCounter += 1}`;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error("conversion timed out"));
    }, SANDBOX_TIMEOUT_MS);
    pending.set(id, { resolve, reject, timer });
    // Transfer the ArrayBuffer so the large file buffer isn't copied.
    sandboxFrame().contentWindow.postMessage(
      { type: "cuc:sandbox-convert", id, bytes, ext, workerSource },
      "*",
      [bytes]
    );
  });
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type !== "cuc:offscreen-convert") return false;
  // Only the extension's own background router may drive conversions.
  if (sender?.id !== chrome.runtime.id || sender?.tab) return false;

  (async () => {
    await whenSandboxReady();
    const ext = String(message.ext || "").toLowerCase();
    const bytes = dataUrlToArrayBuffer(String(message.dataUrl || ""));
    // Only PDFs need the pdfjs worker; read its source here (extension origin)
    // so the sandbox can run it from a same-origin blob.
    let workerSource = null;
    if (ext === "pdf") {
      workerSource = await (await fetch(chrome.runtime.getURL("src/vendor/pdf.worker.min.mjs"))).text();
    }
    const markdown = await runInSandbox(bytes, ext, workerSource);
    if (!markdown.trim()) throw new Error("no extractable text found in the file");
    return markdown;
  })().then(
    markdown => sendResponse({ ok: true, markdown }),
    error => sendResponse({ ok: false, error: String(error?.message || error) })
  );
  return true; // async sendResponse
});
