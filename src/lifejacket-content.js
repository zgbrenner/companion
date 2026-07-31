(() => {
  const CUC = globalThis.ClaudeUsageCompanion;
  const SETTINGS_API = globalThis.CompanionLifejacketSettings;
  const CORE = globalThis.CompanionLifejacketCore;
  if (!CUC || !SETTINGS_API || !CORE || globalThis.CompanionLifejacketContent) return;

  const SETTINGS_KEY = 'cuc:settings';
  const HOST_ID = 'cuc-lifejacket';
  const MAX_FILE_BYTES = 20 * 1024 * 1024;
  const MAX_MARKDOWN_CHARS = 800_000;
  const MAX_PROMPT_CHARS = 120_000;
  const CONVERTIBLE_EXTENSIONS = new Set([
    'pdf', 'docx', 'pptx', 'xlsx', 'odt', 'odp', 'ods', 'rtf', 'csv', 'html', 'htm', 'md', 'txt',
  ]);
  const EDITABLE_SELECTORS = [
    '#prompt-textarea',
    '[data-testid="composer-input"]',
    '[data-testid="prompt-textarea"]',
    'form [contenteditable="true"][role="textbox"]',
    'form textarea',
    '[data-testid*="composer"] [contenteditable="true"]',
    '.ProseMirror[contenteditable="true"]',
    '[contenteditable="true"][data-placeholder]',
  ];
  const SEND_BUTTON_SELECTORS = [
    'button[type="submit"]',
    '[data-testid="send-button"]',
    '[data-testid*="send"]',
    'button[aria-label*="send" i]',
    'button[aria-label*="submit" i]',
  ];

  function providerFromHost(hostname) {
    const host = String(hostname || '').toLowerCase();
    if (host === 'claude.ai' || host.endsWith('.claude.ai')) return 'Claude';
    if (host === 'chatgpt.com' || host.endsWith('.chatgpt.com') || host === 'chat.openai.com') return 'ChatGPT';
    return 'AI';
  }

  function shouldIntercept(value) {
    const candidate = value || {};
    return candidate.showLifejacketMode !== false
      && candidate.lifejacketMode === true
      && (candidate.lifejacketPromptCompression === true || candidate.lifejacketReplyBrevity === true);
  }

  function composeOptimized(text, replyBrevity) {
    return CORE.appendReplySuffix(String(text || '').trim(), replyBrevity === true);
  }

  globalThis.CompanionLifejacketContent = Object.freeze({
    composeOptimized,
    providerFromHost,
    shouldIntercept,
  });

  if (typeof document === 'undefined' || typeof window === 'undefined') return;

  let settings = SETTINGS_API.merge({});
  let host = null;
  let root = null;
  let modalOpen = false;
  let modalOriginal = '';
  let previewGeneration = 0;
  let skipNextSubmission = false;
  let processingPreview = false;
  let placementTimer = null;
  let widthObserver = null;
  let widthTarget = null;
  let lastModelStatus = 'Local Q8 compressor loads on first use';

  function visible(element) {
    if (!element?.isConnected) return false;
    const rect = element.getBoundingClientRect?.();
    if (!rect || rect.width <= 0 || rect.height <= 0) return false;
    const style = getComputedStyle(element);
    return style.display !== 'none' && style.visibility !== 'hidden';
  }

  function isEditable(element) {
    return Boolean(element && (
      element.matches?.('textarea, [contenteditable="true"], [role="textbox"]')
      || element.isContentEditable
    ));
  }

  function composerContainer(editable) {
    if (!editable) return null;
    return editable.closest?.('form, [data-testid*="composer"], [class*="composer"], [data-testid*="chat-input"]') || null;
  }

  function isInsideComposer(element) {
    if (!element) return false;
    const editable = element.closest?.('textarea, [contenteditable="true"], [role="textbox"]')
      || (isEditable(element) ? element : null);
    if (!editable) return false;
    if (editable.id === 'prompt-textarea') return true;
    if (composerContainer(editable)) return true;
    return EDITABLE_SELECTORS.some(selector => {
      try { return editable.matches?.(selector); } catch { return false; }
    });
  }

  function findComposerEditable(preferActive = false) {
    if (preferActive && isInsideComposer(document.activeElement)) {
      return document.activeElement.closest?.('textarea, [contenteditable="true"], [role="textbox"]') || document.activeElement;
    }
    for (const selector of EDITABLE_SELECTORS) {
      let candidates = [];
      try { candidates = [...document.querySelectorAll(selector)]; } catch { candidates = []; }
      const match = candidates.find(candidate => visible(candidate) && isInsideComposer(candidate));
      if (match) return match;
    }
    return null;
  }

  function findComposerAnchor() {
    const editable = findComposerEditable();
    if (!editable) return null;
    const form = editable.closest?.('form');
    return editable.closest?.('[data-testid="composer-shell"], #composer-shell')
      || form?.parentElement
      || composerContainer(editable)
      || editable.parentElement
      || editable;
  }

  function findSendButton(editable = findComposerEditable()) {
    if (!editable) return null;
    const scopes = [editable.closest?.('form'), composerContainer(editable), editable.parentElement, document];
    for (const scope of scopes) {
      if (!scope?.querySelector) continue;
      for (const selector of SEND_BUTTON_SELECTORS) {
        const button = scope.querySelector(selector);
        if (button && visible(button)) return button;
      }
    }
    return null;
  }

  function isSendButton(element) {
    const button = element?.closest?.('button, [role="button"]');
    if (!button) return false;
    let matches = false;
    for (const selector of SEND_BUTTON_SELECTORS) {
      try { if (button.matches(selector)) matches = true; } catch { /* provider markup changed */ }
    }
    if (!matches) return false;
    const editable = findComposerEditable();
    const container = editable && composerContainer(editable);
    return Boolean(editable && (
      button.closest?.('form') === editable.closest?.('form')
      || container?.contains(button)
      || button.parentElement?.contains(editable)
    ));
  }

  function getComposerText(editable = findComposerEditable(true)) {
    if (!editable) return '';
    if ('value' in editable && typeof editable.value === 'string') return editable.value.trim();
    return String(editable.innerText || editable.textContent || '').trim();
  }

  function setNativeValue(element, value) {
    const prototype = element instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : element instanceof HTMLInputElement
        ? HTMLInputElement.prototype
        : null;
    const setter = prototype && Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
    if (setter) setter.call(element, value);
    else element.value = value;
  }

  function setComposerText(value, editable = findComposerEditable()) {
    if (!editable) throw new Error('The message composer is unavailable.');
    const text = String(value || '');
    editable.focus();
    if ('value' in editable && typeof editable.value === 'string') {
      setNativeValue(editable, text);
    } else {
      let inserted = false;
      try {
        const selection = window.getSelection?.();
        const range = document.createRange?.();
        if (selection && range) {
          range.selectNodeContents(editable);
          selection.removeAllRanges();
          selection.addRange(range);
          inserted = document.execCommand?.('insertText', false, text) === true;
        }
      } catch { /* fall back to textContent */ }
      if (!inserted) editable.textContent = text;
    }
    try {
      editable.dispatchEvent(new InputEvent('input', {
        bubbles: true,
        composed: true,
        inputType: 'insertText',
        data: text,
      }));
    } catch {
      editable.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
    }
    editable.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
    return editable;
  }

  function pageIsDark() {
    const documentRoot = document.documentElement;
    const markers = `${documentRoot?.className || ''} ${documentRoot?.getAttribute?.('data-theme') || ''} ${documentRoot?.getAttribute?.('data-color-scheme') || ''}`.toLowerCase();
    if (/\bdark\b/.test(markers)) return true;
    if (/\blight\b/.test(markers)) return false;
    try {
      const background = getComputedStyle(document.body).backgroundColor;
      const match = background.match(/rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/);
      if (match) {
        const luminance = 0.2126 * Number(match[1]) + 0.7152 * Number(match[2]) + 0.0722 * Number(match[3]);
        return luminance < 128;
      }
    } catch { /* body may not be ready */ }
    return Boolean(window.matchMedia?.('(prefers-color-scheme: dark)')?.matches);
  }

  function syncAppearance() {
    host?.classList.toggle('companion-lifejacket-dark', pageIsDark());
  }

  function panelMarkup() {
    return `
      <section class="lj-card" aria-label="Lifejacket Mode">
        <div class="lj-header">
          <div>
            <div class="lj-eyebrow">COMPANION</div>
            <div class="lj-title">Lifejacket Mode</div>
          </div>
          <button class="lj-master" type="button" role="switch" aria-label="Lifejacket Mode" data-lifejacket-setting="lifejacketMode"><span aria-hidden="true"></span></button>
        </div>
        <div class="lj-subtitle">A local safety net for long prompts and expensive replies. Every transformation remains visible before send.</div>
        <div class="lj-settings">
          <div class="lj-setting" data-lifejacket-row="lifejacketPromptCompression">
            <span class="lj-setting-copy"><span class="lj-setting-label">Compress prompts locally</span><span class="lj-setting-description">Run the bundled Q8 LLMLingua-style model before every send.</span></span>
            <button class="lj-switch" type="button" role="switch" aria-label="Compress prompts locally" data-lifejacket-setting="lifejacketPromptCompression"><span aria-hidden="true"></span></button>
          </div>
          <div class="lj-setting" data-lifejacket-row="lifejacketReplyBrevity">
            <span class="lj-setting-copy"><span class="lj-setting-label">Ask for shorter replies</span><span class="lj-setting-description">Append one visible brevity instruction at the end of the prompt.</span></span>
            <button class="lj-switch" type="button" role="switch" aria-label="Ask for shorter replies" data-lifejacket-setting="lifejacketReplyBrevity"><span aria-hidden="true"></span></button>
          </div>
          <div class="lj-setting" data-lifejacket-row="lifejacketFileConversion">
            <span class="lj-setting-copy"><span class="lj-setting-label">Convert files to Markdown</span><span class="lj-setting-description">Parse selected files locally before they enter the composer.</span></span>
            <button class="lj-switch" type="button" role="switch" aria-label="Convert files to Markdown" data-lifejacket-setting="lifejacketFileConversion"><span aria-hidden="true"></span></button>
          </div>
        </div>
        <div class="lj-model-status" data-lifejacket="model-status" aria-live="polite"></div>
        <div class="lj-file" data-lifejacket="file-control" hidden>
          <input class="lj-file-input" data-lifejacket="file-input" type="file" accept=".pdf,.docx,.pptx,.xlsx,.odt,.odp,.ods,.rtf,.csv,.html,.htm,.md,.txt" />
          <button type="button" class="lj-file-button" data-lifejacket-action="pick-file">
            <span class="lj-file-icon" aria-hidden="true">↧</span>
            <span><strong>Choose a file</strong><small data-lifejacket="file-status">PDF, Office, OpenDocument, CSV, HTML, Markdown, or text. Maximum 20 MB.</small></span>
          </button>
        </div>
      </section>
      <div class="lj-overlay" data-lifejacket="preview-dialog" role="dialog" aria-modal="true" aria-labelledby="lifejacket-preview-title" hidden>
        <section class="lj-dialog">
          <div class="lj-dialog-heading">
            <div><div class="lj-eyebrow">LIFEJACKET PREVIEW</div><h2 id="lifejacket-preview-title">Review before sending</h2></div>
            <button class="lj-icon-button" type="button" aria-label="Cancel preview" data-lifejacket-action="cancel">×</button>
          </div>
          <div class="lj-progress" data-lifejacket="preview-status" aria-live="polite">Preparing local preview…</div>
          <label class="lj-text-label" for="lifejacket-preview-text">Optimized prompt</label>
          <textarea class="lj-textarea" id="lifejacket-preview-text" data-lifejacket="preview-text" spellcheck="true"></textarea>
          <details class="lj-original"><summary>Original prompt</summary><pre data-lifejacket="original-text"></pre></details>
          <div class="lj-dialog-actions">
            <button class="lj-button lj-button-primary" type="button" data-lifejacket-action="send-optimized">Send optimized</button>
            <button class="lj-button" type="button" data-lifejacket-action="send-original">Send original</button>
            <button class="lj-button lj-button-quiet" type="button" data-lifejacket-action="cancel">Cancel</button>
          </div>
          <div class="lj-privacy">Prompt text stays on this device. Nothing is sent until you choose a send button.</div>
        </section>
      </div>`;
  }

  async function ensurePanel() {
    if (host?.isConnected && root) return root;
    if (!document.body) return null;
    host = document.getElementById(HOST_ID);
    if (!host) {
      host = document.createElement('section');
      host.id = HOST_ID;
      host.setAttribute('aria-label', 'Lifejacket Mode');
    }
    root = host.shadowRoot || host.attachShadow({ mode: 'open' });
    if (!root.querySelector('.lj-card')) {
      const stylesheet = document.createElement('link');
      stylesheet.rel = 'stylesheet';
      stylesheet.href = chrome.runtime.getURL('src/lifejacket.css');
      root.appendChild(stylesheet);
      const shell = document.createElement('div');
      shell.innerHTML = panelMarkup();
      while (shell.firstChild) root.appendChild(shell.firstChild);
      bindPanelEvents();
    }
    syncAppearance();
    renderPanel();
    placePanel();
    return root;
  }

  function settingButton(key) {
    return root?.querySelector(`[data-lifejacket-setting="${key}"]`) || null;
  }

  function renderPanel() {
    if (!host || !root) return;
    host.classList.toggle('companion-lifejacket-panel-hidden', settings.showLifejacketMode === false);
    for (const key of ['lifejacketMode', 'lifejacketPromptCompression', 'lifejacketReplyBrevity', 'lifejacketFileConversion']) {
      const button = settingButton(key);
      if (!button) continue;
      button.setAttribute('aria-checked', settings[key] === true ? 'true' : 'false');
      if (key !== 'lifejacketMode') button.disabled = settings.lifejacketMode !== true;
    }
    for (const key of ['lifejacketPromptCompression', 'lifejacketReplyBrevity', 'lifejacketFileConversion']) {
      root.querySelector(`[data-lifejacket-row="${key}"]`)?.classList.toggle('lj-setting-disabled', settings.lifejacketMode !== true);
    }
    const fileControl = root.querySelector('[data-lifejacket="file-control"]');
    if (fileControl) fileControl.toggleAttribute('hidden', !(settings.lifejacketMode && settings.lifejacketFileConversion));
    const status = root.querySelector('[data-lifejacket="model-status"]');
    if (status) {
      status.textContent = settings.lifejacketMode
        ? settings.lifejacketPromptCompression
          ? lastModelStatus
          : 'Prompt compression is off. Other enabled Lifejacket tools still work.'
        : 'Lifejacket is off. Child preferences remain saved.';
    }
  }

  async function updateSetting(key, value) {
    const stored = await chrome.storage.local.get([SETTINGS_KEY]);
    const current = stored[SETTINGS_KEY] && typeof stored[SETTINGS_KEY] === 'object' ? stored[SETTINGS_KEY] : {};
    const next = { ...current, [key]: Boolean(value) };
    await chrome.storage.local.set({ [SETTINGS_KEY]: next });
    settings = SETTINGS_API.merge(next);
    renderPanel();
  }

  function bindPanelEvents() {
    root.addEventListener('click', event => {
      const setting = event.target?.closest?.('[data-lifejacket-setting]');
      if (setting) {
        const key = setting.getAttribute('data-lifejacket-setting');
        if (setting.disabled) return;
        updateSetting(key, setting.getAttribute('aria-checked') !== 'true').catch(() => {});
        return;
      }
      const action = event.target?.closest?.('[data-lifejacket-action]')?.getAttribute('data-lifejacket-action');
      if (action === 'pick-file') root.querySelector('[data-lifejacket="file-input"]')?.click();
      if (action === 'cancel') closePreview();
      if (action === 'send-original') submitPreview(modalOriginal);
      if (action === 'send-optimized') {
        const value = root.querySelector('[data-lifejacket="preview-text"]')?.value || '';
        submitPreview(value);
      }
    });

    const input = root.querySelector('[data-lifejacket="file-input"]');
    input?.addEventListener('change', () => {
      const file = input.files?.[0];
      input.value = '';
      if (file) convertSelectedFile(file).catch(error => setFileStatus(error?.message || error, true));
    });

    const fileButton = root.querySelector('.lj-file-button');
    for (const eventName of ['dragenter', 'dragover']) {
      fileButton?.addEventListener(eventName, event => {
        event.preventDefault();
        if (settings.lifejacketMode && settings.lifejacketFileConversion) fileButton.classList.add('lj-file-drag');
      });
    }
    for (const eventName of ['dragleave', 'drop']) {
      fileButton?.addEventListener(eventName, event => {
        event.preventDefault();
        fileButton.classList.remove('lj-file-drag');
      });
    }
    fileButton?.addEventListener('drop', event => {
      const file = event.dataTransfer?.files?.[0];
      if (file) convertSelectedFile(file).catch(error => setFileStatus(error?.message || error, true));
    });
  }

  function setFileStatus(message, isError = false) {
    const status = root?.querySelector('[data-lifejacket="file-status"]');
    if (!status) return;
    status.textContent = String(message || '');
    status.toggleAttribute('data-error', isError);
  }

  function fileExtension(file) {
    const name = String(file?.name || '');
    const dot = name.lastIndexOf('.');
    return dot >= 0 ? name.slice(dot + 1).toLowerCase() : '';
  }

  function readAsDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = () => reject(new Error('The selected file could not be read.'));
      reader.readAsDataURL(file);
    });
  }

  function clampMarkdown(markdown) {
    const text = String(markdown || '').trim();
    if (!text) throw new Error('The selected file contained no extractable text.');
    if (text.length <= MAX_MARKDOWN_CHARS) return text;
    return `${text.slice(0, MAX_MARKDOWN_CHARS)}\n\n[truncated locally because the converted text exceeded ${MAX_MARKDOWN_CHARS.toLocaleString()} characters]`;
  }

  async function convertFileToMarkdown(file) {
    if (!settings.lifejacketMode || !settings.lifejacketFileConversion) throw new Error('File conversion is turned off.');
    if (!file || file.size <= 0) throw new Error('Choose a non-empty file.');
    if (file.size > MAX_FILE_BYTES) throw new Error('The file exceeds the 20 MB local conversion limit.');
    const ext = fileExtension(file);
    if (!CONVERTIBLE_EXTENSIONS.has(ext)) throw new Error('That file type is not supported.');
    if (ext === 'txt' || ext === 'md') return clampMarkdown(await file.text());
    const response = await chrome.runtime.sendMessage({
      type: 'cuc:lifejacket-convert-file',
      dataUrl: await readAsDataUrl(file),
      ext,
    });
    if (!response?.ok) throw new Error(String(response?.error || 'Local file conversion failed.'));
    return clampMarkdown(response.markdown);
  }

  async function convertSelectedFile(file) {
    setFileStatus(`Converting ${file.name} locally…`);
    const markdown = await convertFileToMarkdown(file);
    const editable = findComposerEditable();
    if (!editable) throw new Error('Open a message composer before converting a file.');
    const existing = getComposerText(editable);
    const combined = existing ? `${existing}\n\n${markdown}` : markdown;
    setComposerText(combined, editable);
    setFileStatus(`Added ${file.name} as Markdown locally.`);
  }

  function setPreviewBusy(value) {
    processingPreview = Boolean(value);
    const primary = root?.querySelector('[data-lifejacket-action="send-optimized"]');
    if (primary) primary.disabled = processingPreview;
  }

  function setPreviewStatus(message, level = '') {
    const status = root?.querySelector('[data-lifejacket="preview-status"]');
    if (!status) return;
    status.textContent = String(message || '');
    if (level) status.dataset.level = level;
    else delete status.dataset.level;
  }

  async function openPreview(originalValue) {
    const original = String(originalValue || '').trim();
    if (!original || modalOpen) return;
    await ensurePanel();
    modalOpen = true;
    modalOriginal = original;
    const generation = ++previewGeneration;
    const dialog = root.querySelector('[data-lifejacket="preview-dialog"]');
    const preview = root.querySelector('[data-lifejacket="preview-text"]');
    const originalNode = root.querySelector('[data-lifejacket="original-text"]');
    if (originalNode) originalNode.textContent = original;
    if (preview) preview.value = composeOptimized(original, settings.lifejacketReplyBrevity);
    dialog?.removeAttribute('hidden');
    setPreviewBusy(settings.lifejacketPromptCompression === true);
    setPreviewStatus(settings.lifejacketPromptCompression ? 'Compressing with the bundled local Q8 model…' : 'Prompt compression is off. Review the final instruction below.');

    let compressed = original;
    let response = null;
    if (settings.lifejacketPromptCompression) {
      if (original.length > MAX_PROMPT_CHARS) {
        response = { ok: false, error: `Prompt exceeds ${MAX_PROMPT_CHARS.toLocaleString()} characters.` };
      } else {
        try {
          response = await chrome.runtime.sendMessage({
            type: 'cuc:lifejacket-compress',
            text: original,
            keepRatio: settings.lifejacketKeepRatio,
          });
          if (!response?.ok) throw new Error(response?.error || 'The local compressor did not return a result.');
          compressed = String(response.text || original).trim() || original;
        } catch (error) {
          response = { ok: false, error: String(error?.message || error) };
          compressed = original;
        }
      }
    }

    if (!modalOpen || generation !== previewGeneration) return;
    const optimized = composeOptimized(compressed, settings.lifejacketReplyBrevity);
    if (preview) preview.value = optimized;
    if (settings.lifejacketPromptCompression) {
      if (response?.ok) {
        const details = [
          response.changed ? `${response.savedPct || 0}% shorter` : 'no safe reduction',
          response.durationMs != null ? `${response.durationMs} ms` : null,
          response.chunks ? `${response.chunks} chunk${response.chunks === 1 ? '' : 's'}` : null,
        ].filter(Boolean).join(' · ');
        lastModelStatus = `Local Q8 compressor ready${response.durationMs != null ? ` · last run ${response.durationMs} ms` : ''}`;
        setPreviewStatus(`${details || 'Local compression complete'}${response.warning ? ` · ${response.warning}` : ''}`, response.warning ? 'warning' : 'success');
      } else {
        lastModelStatus = 'Local compressor failed safely. The original prompt was preserved.';
        setPreviewStatus(`Compression failed safely: ${response?.error || 'unknown error'}. The original prompt was kept.`, 'warning');
      }
    } else {
      setPreviewStatus(settings.lifejacketReplyBrevity ? 'Reply brevity instruction appended visibly at the end.' : 'No prompt transformation is enabled.');
    }
    setPreviewBusy(false);
    renderPanel();
    preview?.focus();
    preview?.setSelectionRange?.(preview.value.length, preview.value.length);
  }

  function closePreview() {
    if (!modalOpen) return;
    modalOpen = false;
    previewGeneration += 1;
    setPreviewBusy(false);
    root?.querySelector('[data-lifejacket="preview-dialog"]')?.setAttribute('hidden', '');
    findComposerEditable()?.focus();
  }

  function submitPreview(value) {
    const text = String(value || '').trim();
    if (!text) {
      setPreviewStatus('The prompt is empty. Add text or send the original.', 'warning');
      return;
    }
    let editable;
    try { editable = setComposerText(text); } catch (error) {
      setPreviewStatus(String(error?.message || error), 'warning');
      return;
    }
    closePreview();
    skipNextSubmission = true;
    requestAnimationFrame(() => {
      const button = findSendButton(editable);
      if (button && !button.disabled) {
        button.click();
        setTimeout(() => { skipNextSubmission = false; }, 0);
        return;
      }
      try {
        editable.dispatchEvent(new KeyboardEvent('keydown', {
          key: 'Enter',
          code: 'Enter',
          bubbles: true,
          cancelable: true,
        }));
      } finally {
        setTimeout(() => { skipNextSubmission = false; }, 0);
      }
    });
  }

  function interceptSend(event) {
    if (skipNextSubmission) {
      skipNextSubmission = false;
      return;
    }
    if (!shouldIntercept(settings) || modalOpen) return;
    let shouldHandle = false;
    if (event.type === 'keydown') {
      shouldHandle = event.key === 'Enter'
        && !event.shiftKey
        && !event.altKey
        && !event.ctrlKey
        && !event.metaKey
        && !event.isComposing
        && isInsideComposer(event.target);
    } else if (event.type === 'click') {
      shouldHandle = isSendButton(event.target);
    }
    if (!shouldHandle) return;
    const text = getComposerText();
    if (!text) return;
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    openPreview(text).catch(() => {});
  }

  function syncWidth(target) {
    if (!host || !target) return;
    const apply = () => {
      if (!host?.isConnected || !target.isConnected) return;
      const width = target.getBoundingClientRect?.().width;
      if (width > 240) host.style.width = `${Math.round(width)}px`;
    };
    if (widthTarget !== target && typeof ResizeObserver !== 'undefined') {
      widthObserver?.disconnect();
      widthObserver = new ResizeObserver(apply);
      widthObserver.observe(target);
      widthTarget = target;
    }
    apply();
  }

  function placePanel() {
    if (!host) return;
    const target = findComposerAnchor();
    if (!target?.parentElement) {
      host.remove();
      return;
    }
    if (host.parentElement !== target.parentElement || host.previousElementSibling !== target) {
      target.parentElement.insertBefore(host, target.nextSibling);
    }
    syncWidth(target);
    syncAppearance();
  }

  function schedulePlacement() {
    clearTimeout(placementTimer);
    placementTimer = setTimeout(() => {
      if (settings.showLifejacketMode === false) {
        renderPanel();
        return;
      }
      ensurePanel().then(placePanel).catch(() => {});
    }, 60);
  }

  async function loadState() {
    const stored = await chrome.storage.local.get([SETTINGS_KEY]);
    settings = SETTINGS_API.merge(stored[SETTINGS_KEY]);
  }

  function observePage() {
    window.addEventListener('keydown', interceptSend, true);
    window.addEventListener('click', interceptSend, true);
    window.addEventListener('popstate', schedulePlacement);
    window.addEventListener('resize', schedulePlacement);
    window.addEventListener('keydown', event => {
      if (event.key === 'Escape' && modalOpen) {
        event.preventDefault();
        closePreview();
      }
    }, true);

    const observer = new MutationObserver(schedulePlacement);
    observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'data-theme', 'data-color-scheme'] });
    window.matchMedia?.('(prefers-color-scheme: dark)')?.addEventListener?.('change', syncAppearance);
    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName !== 'local' || !changes[SETTINGS_KEY]) return;
      settings = SETTINGS_API.merge(changes[SETTINGS_KEY].newValue);
      renderPanel();
      schedulePlacement();
    });
  }

  async function boot() {
    await loadState();
    observePage();
    await ensurePanel();
    schedulePlacement();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => boot().catch(() => {}), { once: true });
  } else {
    boot().catch(() => {});
  }
})();
