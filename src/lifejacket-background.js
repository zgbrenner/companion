const MAX_INPUT_CHARS = 120_000;
const REQUEST_TIMEOUT_MS = 45_000;
const FILE_REQUEST_TIMEOUT_MS = 70_000;
const MIN_KEEP_RATIO = 0.4;
const MAX_KEEP_RATIO = 0.85;
const MAX_CONVERT_DATAURL_CHARS = 30_000_000;
const MAX_PENDING_COMPRESSIONS = 2;
const CONVERTIBLE_EXTENSIONS = new Set([
  'pdf', 'docx', 'pptx', 'xlsx', 'odt', 'odp', 'ods', 'rtf', 'csv', 'html', 'htm',
]);

const ALLOWED_HOSTS = new Set([
  'claude.ai',
  'chatgpt.com',
  'chat.openai.com',
]);

let lifejacketOffscreenCreating = null;
let lifejacketCompressionQueue = Promise.resolve();
let pendingCompressions = 0;

function enqueueLifejacketCompression(task) {
  if (pendingCompressions >= MAX_PENDING_COMPRESSIONS) {
    return Promise.reject(new Error('Lifejacket is busy; try again in a moment.'));
  }
  pendingCompressions += 1;
  const next = lifejacketCompressionQueue.then(task, task);
  lifejacketCompressionQueue = next.catch(() => undefined);
  return next.finally(() => {
    pendingCompressions -= 1;
  });
}

function lifejacketSenderUrl(sender) {
  const raw = String(sender?.url || sender?.tab?.url || '');
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== 'https:') return null;
    const host = parsed.hostname.toLowerCase();
    const allowed = ALLOWED_HOSTS.has(host)
      || host.endsWith('.claude.ai')
      || host.endsWith('.chatgpt.com');
    return allowed ? parsed : null;
  } catch {
    return null;
  }
}

function lifejacketSenderOrigin(sender) {
  return lifejacketSenderUrl(sender)?.origin || null;
}

function isChatGptSender(sender) {
  const host = lifejacketSenderUrl(sender)?.hostname?.toLowerCase() || '';
  return host === 'chat.openai.com' || host === 'chatgpt.com' || host.endsWith('.chatgpt.com');
}

function validateLifejacketSender(sender) {
  if (sender?.id !== chrome.runtime.id) return 'Invalid sender.';
  if (sender.frameId !== 0) return 'Lifejacket processing is limited to the top frame.';
  if (!lifejacketSenderOrigin(sender)) return 'Unsupported sender origin.';
  return null;
}

function validateLifejacketRequest(message, sender) {
  const senderError = validateLifejacketSender(sender);
  if (senderError) return senderError;
  if (typeof message?.text !== 'string' || !message.text.trim()) return 'Prompt text is required.';
  if (message.text.length > MAX_INPUT_CHARS) return `Prompt size exceeds ${MAX_INPUT_CHARS} characters.`;
  const keepRatio = Number(message.keepRatio);
  if (!Number.isFinite(keepRatio) || keepRatio < MIN_KEEP_RATIO || keepRatio > MAX_KEEP_RATIO) {
    return `Compression ratio must be between ${MIN_KEEP_RATIO} and ${MAX_KEEP_RATIO}.`;
  }
  return null;
}

function validateFileRequest(message, sender) {
  const senderError = validateLifejacketSender(sender);
  if (senderError) return senderError;
  const ext = String(message?.ext || '').toLowerCase();
  if (!CONVERTIBLE_EXTENSIONS.has(ext)) return 'Unsupported file type.';
  if (typeof message?.dataUrl !== 'string'
    || !message.dataUrl.startsWith('data:')
    || message.dataUrl.length > MAX_CONVERT_DATAURL_CHARS) {
    return 'Invalid or oversized file data.';
  }
  return null;
}

async function ensureLifejacketOffscreenDocument() {
  if (!chrome.offscreen?.createDocument) throw new Error('Offscreen documents are unsupported in this browser.');
  if (await chrome.offscreen.hasDocument?.()) return;
  if (!lifejacketOffscreenCreating) {
    lifejacketOffscreenCreating = chrome.offscreen.createDocument({
      url: 'src/offscreen.html',
      reasons: ['WORKERS'],
      justification: 'Run the local Lifejacket prompt compressor and sandboxed file-to-Markdown service.',
    }).finally(() => {
      lifejacketOffscreenCreating = null;
    });
  }
  await lifejacketOffscreenCreating;
}

function withLifejacketTimeout(promise, timeoutMs = REQUEST_TIMEOUT_MS, label = 'Lifejacket compression') {
  let timer = null;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out.`)), timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function normalizeLifejacketResponse(response) {
  if (!response || typeof response !== 'object') throw new Error('Lifejacket returned no result.');
  if (response.ok !== true) {
    throw new Error(String(response.error || 'Lifejacket compression failed.').slice(0, 240));
  }
  if (typeof response.text !== 'string' || !response.text.trim()) {
    throw new Error('Lifejacket returned invalid prompt text.');
  }
  return {
    ok: true,
    text: response.text,
    accepted: response.accepted === true,
    changed: response.changed === true,
    savedPct: Number.isFinite(Number(response.savedPct)) ? Math.max(0, Math.min(100, Math.round(Number(response.savedPct)))) : 0,
    model: String(response.model || 'Local Lifejacket compressor').slice(0, 100),
    durationMs: Number.isFinite(Number(response.durationMs)) ? Math.max(0, Math.round(Number(response.durationMs))) : null,
    chunks: Number.isFinite(Number(response.chunks)) ? Math.max(1, Math.round(Number(response.chunks))) : 1,
    modelInvoked: response.modelInvoked === true,
    warning: response.warning == null ? null : String(response.warning).slice(0, 240),
  };
}

function normalizeFileResponse(response) {
  if (!response || typeof response !== 'object' || response.ok !== true) {
    throw new Error(String(response?.error || 'File conversion failed.').slice(0, 240));
  }
  const markdown = String(response.markdown || '');
  if (!markdown.trim()) throw new Error('The file contained no extractable text.');
  return { ok: true, markdown };
}

function routeFileConversion(message, sender, sendResponse) {
  const validationError = validateFileRequest(message, sender);
  if (validationError) {
    sendResponse({ ok: false, error: validationError });
    return false;
  }
  (async () => {
    await ensureLifejacketOffscreenDocument();
    const response = await withLifejacketTimeout(chrome.runtime.sendMessage({
      type: 'cuc:offscreen-convert',
      dataUrl: message.dataUrl,
      ext: String(message.ext).toLowerCase(),
    }), FILE_REQUEST_TIMEOUT_MS, 'File conversion');
    return normalizeFileResponse(response);
  })().then(
    result => sendResponse(result),
    error => sendResponse({ ok: false, error: String(error?.message || error).slice(0, 240) }),
  );
  return true;
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === 'cuc:lifejacket-compress') {
    const validationError = validateLifejacketRequest(message, sender);
    if (validationError) {
      sendResponse({ ok: false, error: validationError });
      return false;
    }

    const keepRatio = Number(message.keepRatio);
    (async () => {
      await ensureLifejacketOffscreenDocument();
      const response = await withLifejacketTimeout(
        enqueueLifejacketCompression(() => chrome.runtime.sendMessage({
          type: 'cuc:lifejacket-compress-offscreen',
          text: message.text,
          keepRatio,
        })),
      );
      return normalizeLifejacketResponse(response);
    })().then(
      result => sendResponse(result),
      error => sendResponse({ ok: false, error: String(error?.message || error).slice(0, 240) }),
    );
    return true;
  }

  if (message?.type === 'cuc:lifejacket-convert-file') {
    return routeFileConversion(message, sender, sendResponse);
  }

  // The cross-provider content script deliberately keeps the original
  // `cuc:convert-file` message so Claude's mature converter route remains
  // untouched. Claude is handled by background.js; only ChatGPT reaches this
  // compatibility alias, avoiding duplicate responses from two listeners.
  if (message?.type === 'cuc:convert-file' && isChatGptSender(sender)) {
    return routeFileConversion(message, sender, sendResponse);
  }

  return undefined;
});
