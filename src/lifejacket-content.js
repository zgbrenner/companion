(() => {
  const CUC = globalThis.ClaudeUsageCompanion;
  const LIFEJACKET_SETTINGS = globalThis.CompanionLifejacketSettings;
  const LIFEJACKET_CORE = globalThis.CompanionLifejacketCore;
  if (!CUC || !LIFEJACKET_SETTINGS || !LIFEJACKET_CORE) return;
  if (globalThis.CompanionLifejacketContent) return;

  const SETTINGS_KEY = 'cuc:settings';
  const HOST_ID = 'companion-lifejacket';
  const MAX_FILE_BYTES = 20 * 1024 * 1024;
  const MAX_MARKDOWN_CHARS = 800_000;
  const MAX_PROMPT_CHARS = 120_000;
  const CONVERTIBLE_EXTENSIONS = new Set([
    'pdf', 'docx', 'pptx', 'xlsx', 'odt', 'odp', 'ods', 'rtf',
    'csv', 'html', 'htm', 'md', 'txt',
  ]);
  const COMPOSER_SELECTORS = [
    '#prompt-textarea',
    '[data-testid="composer-input"]',
    '[data-testid="prompt-textarea"]',
    '[data-testid*="composer"] [contenteditable="true"]',
    '[data-testid*="chat-input"] [contenteditable="true"]',
    'form [contenteditable="true"][role="textbox"]',
    'form textarea',
    'div[contenteditable="true"][role="textbox"]',
  ];

  let settings = LIFEJACKET_SETTINGS.merge({});
  let host = null;
  let root = null;
  let modalOpen = false;
  let modalOriginal = '';
  let skipNextSend = false;
  let previewGeneration = 0;
  let placementTimer = null;
  let widthObserver = null;
  let widthTarget = null;
  let fileStatusTimer = null;

  function providerFromHost(hostname) {
    const value = String(hostname || '').toLowerCase();
    return value === 'claude.ai' || value.endsWith('.claude.ai') ? 'Claude' : 'ChatGPT';
  }

  function shouldIntercept(value) {
    return Boolean(
      value?.lifejacketMode
      && (value.lifejacketPromptCompression || value.lifejacketReplyBrevity),
    );
  }

  function composeOptimized(text, replyBrevity) {
    return LIFEJACKET_CORE.appendReplySuffix(String(text || '').trim(), Boolean(replyBrevity));
  }

  globalThis.CompanionLifejacketContent = Object.freeze({
    composeOptimized,
    providerFromHost,
    shouldIntercept,
  });

  function visible(element) {
    if (!element?.isConnected) return false;
    const rect = element.getBoundingClientRect?.();
    if (!rect || rect.width <= 0 || rect.height <= 0) return false;
    const style = getComputedStyle(element);
    return style.display !== 'none' && style.visibility !== 'hidden';
  }

  function composerEditable(preferActive = false) {
    if (preferActive) {
      const active = document.activeElement;
      if (active && isComposerEditable(active)) return active;
    }
    for (const selector of COMPOSER_SELECTORS) {
      let candidates = [];
      try {
        candidates = document.querySelectorAll(selector);
      } catch {
        continue;
      }
      for (const candidate of candidates) if (visible(candidate) && isComposerEditable(candidate, true)) return candidate;
    }
    return null;
  }

  function composerAnchor() {
    const editable = COMPOSER_SELECTORS
      .flatMap(selector => {
        try { return [...document.querySelectorAll(selector)]; }
        catch { return []; }
      })
      .find(visible);
    if (!editable) return null;
    return editable.closest('form, [data-testid*="composer"], [data-testid*="chat-input"], [class*="composer"]')
      || editable.parentElement
      || editable;
  }

  function isComposerEditable(element, allowUnresolved = false) {
    if (!element || element === host || host?.contains?.(element)) return false;
    const editable = element.closest?.('textarea, [contenteditable="true"], [role="textbox"]')
      || (element.isContentEditable ? element : null);
    if (!editable) return false;
    if (editable.id === 'prompt-textarea') return true;
    if (editable.closest?.('form, [data-testid*="composer"], [data-testid*="chat-input"], [class*="composer"]')) return true;
    if (allowUnresolved) return false;
    const anchor = composerAnchor();
    return Boolean(anchor && (anchor.contains(editable) || editable.contains(anchor)));
  }

  function composerText() {
    const editable = composerEditable(true) || composerEditable(false);
    return String(editable?.value ?? editable?.innerText ?? editable?.textContent ?? '').trim();
  }

  function setComposerText(text) {
    const editable = composerEditable(false);
    if (!editable) return false;
    const value = String(text || '');
    editable.focus();
    if (editable.tagName === 'TEXTAREA') {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
      if (setter) setter.call(editable, value);
      else editable.value = value;
      editable.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    }

    const selection = window.getSelection?.();
    const range = document.createRange?.();
    if (selection && range) {
      range.selectNodeContents(editable);
      selection.removeAllRanges();
      selection.addRange(range);
    }
    let inserted = false;
    try { inserted = document.execCommand?.('insertText', false, value) === true; }
    catch { inserted = false; }
    if (!inserted) {
      editable.textContent = value;
      const event = typeof InputEvent === 'function'
        ? new InputEvent('input', { bubbles: true, inputType: 'insertText', data: value })
        : new Event('input', { bubbles: true });
      editable.dispatchEvent(event);
    }
    return true;
  }

  function sendButton() {
    const anchor = composerAnchor();
    const scope = anchor?.closest?.('form, [data-testid*="composer"], [data-testid*="chat-input"]')
      || anchor?.parentElement
      || document;
    const selectors = [
      'button[data-testid*="send"]:not([disabled])',
      'button[aria-label*="send" i]:not([disabled])',
      'button[type="submit"]:not([disabled])',
    ];
    for (const selector of selectors) {
      const scoped = scope.querySelector?.(selector);
      if (scoped) return scoped;
      const global = document.querySelector(selector);
      if (global) return global;
    }
    return null;
  }

  async function sendComposerMessage(text) {
    if (!setComposerText(text)) return false;
    await new Promise(resolve => setTimeout(resolve, 120));
    skipNextSend = true;
    const button = sendButton();
    if (button) {
      button.click();
      return true;
    }
    const editable = composerEditable(false);
    if (!editable) {
      skipNextSend = false;
      return false;
    }
    editable.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'Enter',
      code: 'Enter',
      keyCode: 13,
      which: 13,
      bubbles: true,
      cancelable: true,
    }));
    return true;
  }

  function pageIsDark() {
    const html = document.documentElement;
    const markers = `${html?.className || ''} ${html?.getAttribute?.('data-theme') || ''} ${html?.getAttribute?.('data-color-scheme') || ''}`.toLowerCase();
    if (/\bdark\b/.test(markers)) return true;
    if (/\blight\b/.test(markers)) return false;
    try {
      const match = getComputedStyle(document.body).backgroundColor.match(/rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/);
      if (match) return 0.2126 * Number(match[1]) + 0.7152 * Number(match[2]) + 0.0722 * Number(match[3]) < 128;
    } catch { /* body may not exist */ }
    return Boolean(window.matchMedia?.('(prefers-color-scheme: dark)')?.matches);
  }

  function syncAppearance() {
    host?.classList.toggle('companion-lifejacket-dark', pageIsDark());
  }

  function visualComposerBox(anchor) {
    let node = anchor;
    let best = null;
    for (let depth = 0; depth < 8 && node && node !== document.body; depth += 1) {
      try {
        const style = getComputedStyle(node);
        const rect = node.getBoundingClientRect();
        const rounded = parseFloat(style.borderTopLeftRadius) >= 8;
        const surfaced = style.boxShadow !== 'none'
          || (style.borderTopStyle !== 'none' && parseFloat(style.borderTopWidth) > 0)
          || !['transparent', 'rgba(0, 0, 0, 0)'].includes(style.backgroundColor);
        if (rounded && surfaced && rect.width >= 220 && rect.height > 0 && rect.height <= innerHeight * 0.45) best = node;
      } catch { break; }
      node = node.parentElement;
    }
    return best;
  }

  function placementTarget() {
    const providerWidget = document.querySelector('#cuc-openai-widget, #cuc-widget');
    if (providerWidget?.isConnected) return providerWidget;
    const anchor = composerAnchor();
    return visualComposerBox(anchor) || anchor;
  }

  function syncWidth(target) {
    if (!host || !target) return;
    const apply = () => {
      if (!host || !target.isConnected) return;
      const width = target.getBoundingClientRect().width;
      if (width > 0) host.style.width = `${width}px`;
    };
    if (widthTarget !== target) {
      widthObserver?.disconnect();
      widthTarget = target;
      if (typeof ResizeObserver === 'function') {
        widthObserver = new ResizeObserver(apply);
        widthObserver.observe(target);
      }
    }
    apply();
  }

  function placePanel() {
    if (!host) return;
    const target = placementTarget();
    if (!target?.parentElement) {
      host.remove();
      return;
    }
    if (host.parentElement !== target.parentElement || host.previousElementSibling !== target) {
      try { target.parentElement.insertBefore(host, target.nextSibling); }
      catch { return; }
    }
    syncWidth(target);
    syncAppearance();
  }

  function schedulePlacement() {
    clearTimeout(placementTimer);
    placementTimer = setTimeout(placePanel, 60);
  }

  function switchMarkup(key, label, description) {
    return `
      <div class="lj-setting" data-lj-row="${key}">
        <span class="lj-setting-copy">
          <span class="lj-setting-label">${label}</span>
          <span class="lj-setting-description">${description}</span>
        </span>
        <button type="button" class="lj-switch" role="switch" aria-checked="false" data-lj-setting="${key}" aria-label="${label}"><span></span></button>
      </div>`;
  }

  async function ensurePanel() {
    if (root || !document.body) return;
    host = document.createElement('section');
    host.id = HOST_ID;
    host.setAttribute('aria-label', 'Lifejacket Mode');
    const shadow = host.attachShadow({ mode: 'open' });
    const css = await fetch(chrome.runtime.getURL('src/lifejacket.css')).then(response => {
      if (!response.ok) throw new Error(`Lifejacket CSS ${response.status}`);
      return response.text();
    }).catch(() => '');
    const style = document.createElement('style');
    style.textContent = css;
    shadow.appendChild(style);

    const container = document.createElement('div');
    container.className = 'lj-root';
    container.innerHTML = `
      <section class="lj-card">
        <div class="lj-header">
          <div>
            <div class="lj-eyebrow">COMPANION</div>
            <div class="lj-title">Lifejacket Mode</div>
          </div>
          <button type="button" class="lj-master" role="switch" aria-checked="false" data-lj-setting="lifejacketMode" aria-label="Lifejacket Mode"><span></span></button>
        </div>
        <div class="lj-subtitle">Stretch the conversation locally without giving up the details that matter.</div>
        <div class="lj-settings">
          ${switchMarkup('lifejacketPromptCompression', 'Compress prompts', 'Run the local quantized compressor before each send.')}
          ${switchMarkup('lifejacketReplyBrevity', 'Shorter replies', 'Add a visible brevity request at the end of the optimized prompt.')}
          ${switchMarkup('lifejacketFileConversion', 'Files to Markdown', 'Convert supported files locally before they enter the composer.')}
        </div>
        <div class="lj-model-status" data-lj="model-status" aria-live="polite"></div>
        <div class="lj-file" data-lj="file" hidden>
          <input data-lj="file-input" type="file" accept=".pdf,.docx,.pptx,.xlsx,.odt,.odp,.ods,.rtf,.csv,.html,.htm,.md,.txt" hidden />
          <button type="button" class="lj-file-button" data-lj-action="pick-file">
            <span class="lj-file-icon" aria-hidden="true">↥</span>
            <span><strong>Choose a file</strong><small data-lj="file-status">PDF, Office, CSV, HTML, Markdown, or text. Up to 20 MB.</small></span>
          </button>
        </div>
      </section>
      <div class="lj-overlay" data-lj="overlay" hidden>
        <section class="lj-dialog" role="dialog" aria-modal="true" aria-labelledby="lj-dialog-title">
          <div class="lj-dialog-heading">
            <div>
              <div class="lj-eyebrow">LIFEJACKET MODE</div>
              <h2 id="lj-dialog-title">Review optimized prompt</h2>
            </div>
            <button type="button" class="lj-icon-button" data-lj-action="cancel" aria-label="Close prompt preview">×</button>
          </div>
          <div class="lj-progress" data-lj="preview-status" aria-live="polite">Preparing preview…</div>
          <label class="lj-text-label" for="lj-optimized-text">Optimized prompt</label>
          <textarea id="lj-optimized-text" class="lj-textarea" data-lj="optimized" rows="9"></textarea>
          <details class="lj-original">
            <summary>Show original prompt</summary>
            <pre data-lj="original"></pre>
          </details>
          <div class="lj-dialog-actions">
            <button type="button" class="lj-button lj-button-primary" data-lj-action="send-optimized" disabled>Send optimized</button>
            <button type="button" class="lj-button" data-lj-action="send-original">Send original</button>
            <button type="button" class="lj-button lj-button-quiet" data-lj-action="cancel">Cancel</button>
          </div>
          <div class="lj-privacy">Processed on this device. Prompt text is not stored.</div>
        </section>
      </div>`;
    shadow.appendChild(container);
    root = shadow;
    document.body.appendChild(host);
    wirePanel();
    render();
    placePanel();
  }

  function setSwitch(key, value, disabled = false) {
    const button = root?.querySelector(`[data-lj-setting="${key}"]`);
    if (!button) return;
    button.setAttribute('aria-checked', String(Boolean(value)));
    button.disabled = disabled;
  }

  function render() {
    if (!root || !host) return;
    host.style.display = 'block';
    host.classList.toggle('companion-lifejacket-panel-hidden', settings.showLifejacketMode === false);
    setSwitch('lifejacketMode', settings.lifejacketMode);
    const childDisabled = !settings.lifejacketMode;
    setSwitch('lifejacketPromptCompression', settings.lifejacketPromptCompression, childDisabled);
    setSwitch('lifejacketReplyBrevity', settings.lifejacketReplyBrevity, childDisabled);
    setSwitch('lifejacketFileConversion', settings.lifejacketFileConversion, childDisabled);
    root.querySelectorAll('.lj-setting').forEach(row => row.classList.toggle('lj-setting-disabled', childDisabled));
    const file = root.querySelector('[data-lj="file"]');
    if (file) file.hidden = !(settings.lifejacketMode && settings.lifejacketFileConversion);
    const status = root.querySelector('[data-lj="model-status"]');
    if (status) {
      if (!settings.lifejacketMode) status.textContent = 'Off. Your feature choices stay saved.';
      else if (settings.lifejacketPromptCompression) status.textContent = 'Local MobileBERT Q8 compressor loads on the first optimized send.';
      else if (settings.lifejacketReplyBrevity) status.textContent = 'Prompt compression is off. Reply brevity remains active.';
      else status.textContent = 'Only file conversion is active.';
    }
    schedulePlacement();
  }

  async function saveSetting(key, value) {
    const stored = await chrome.storage.local.get([SETTINGS_KEY]);
    settings = LIFEJACKET_SETTINGS.merge({
      ...(stored[SETTINGS_KEY] || {}),
      [key]: value,
    });
    await chrome.storage.local.set({ [SETTINGS_KEY]: settings });
    render();
  }

  function setPreviewStatus(text, level = 'neutral') {
    const status = root?.querySelector('[data-lj="preview-status"]');
    if (!status) return;
    status.textContent = text;
    status.dataset.level = level;
  }

  function showPreview(original) {
    modalOriginal = original;
    modalOpen = true;
    const generation = ++previewGeneration;
    root.querySelector('[data-lj="original"]').textContent = original;
    root.querySelector('[data-lj="optimized"]').value = original;
    root.querySelector('[data-lj-action="send-optimized"]').disabled = true;
    root.querySelector('[data-lj="overlay"]').hidden = false;
    setPreviewStatus(settings.lifejacketPromptCompression ? 'Loading the local compressor…' : 'Preparing the reply-brevity suffix…');
    root.querySelector('[data-lj="optimized"]').focus();
    prepareOptimizedPrompt(original, generation);
  }

  async function prepareOptimizedPrompt(original, generation) {
    let candidate = original;
    let detail = '';
    let level = 'neutral';
    if (settings.lifejacketPromptCompression) {
      try {
        const response = await chrome.runtime.sendMessage({
          type: 'cuc:lifejacket-compress',
          text: original,
          keepRatio: settings.lifejacketKeepRatio,
        });
        if (!response?.ok) throw new Error(response?.error || 'Local compression failed.');
        candidate = String(response.text || original);
        const duration = Number.isFinite(response.durationMs) ? ` in ${(response.durationMs / 1000).toFixed(1)}s` : '';
        if (response.changed) {
          detail = `${response.model || 'Local compressor'} removed ${response.savedPct || 0}%${duration}.`;
          level = 'success';
        } else {
          detail = `${response.model || 'Local compressor'} ran${duration}; safety checks kept the original wording.`;
          level = response.warning ? 'warning' : 'neutral';
        }
      } catch (error) {
        candidate = original;
        detail = `Compression was unavailable, so the original prompt was preserved. ${String(error?.message || error).slice(0, 160)}`;
        level = 'warning';
      }
    } else {
      detail = 'Prompt compression is off.';
    }
    if (!modalOpen || generation !== previewGeneration) return;
    const optimized = composeOptimized(candidate, settings.lifejacketReplyBrevity);
    root.querySelector('[data-lj="optimized"]').value = optimized;
    root.querySelector('[data-lj-action="send-optimized"]').disabled = false;
    const suffixNote = settings.lifejacketReplyBrevity ? ' A visible request for a shorter reply is appended at the end.' : '';
    setPreviewStatus(`${detail}${suffixNote}`, level);
  }

  function closePreview() {
    previewGeneration += 1;
    modalOpen = false;
    modalOriginal = '';
    const overlay = root?.querySelector('[data-lj="overlay"]');
    if (overlay) overlay.hidden = true;
  }

  async function sendPreviewText(text) {
    const value = String(text || '').trim();
    if (!value) return;
    closePreview();
    const sent = await sendComposerMessage(value);
    if (!sent) setFileStatus('Could not restore the prompt to the composer.', true);
  }

  function interceptSend(event) {
    if (!shouldIntercept(settings) || modalOpen) return;
    if (skipNextSend) {
      skipNextSend = false;
      return;
    }
    const text = composerText();
    if (!text) return;
    if (text.length > MAX_PROMPT_CHARS) {
      event.preventDefault();
      event.stopImmediatePropagation();
      showPreview(text);
      setPreviewStatus(`This prompt exceeds ${MAX_PROMPT_CHARS.toLocaleString()} characters, so compression will safely fall back to the original.`, 'warning');
      return;
    }
    event.preventDefault();
    event.stopImmediatePropagation();
    showPreview(text);
  }

  function observeSends() {
    window.addEventListener('keydown', event => {
      if (event.isComposing || event.keyCode === 229) return;
      const send = event.key === 'Enter' && !event.shiftKey && !event.metaKey && !event.ctrlKey && !event.altKey;
      if (!send) return;
      if (!isComposerEditable(document.activeElement) && !isComposerEditable(event.target)) return;
      interceptSend(event);
    }, true);

    window.addEventListener('click', event => {
      const button = event.target?.closest?.('button, [role="button"]');
      if (!button || host?.contains?.(button)) return;
      const label = `${button.getAttribute?.('aria-label') || ''} ${button.textContent || ''}`.toLowerCase();
      const send = /\bsend\b/.test(label) || button.matches?.('button[type="submit"]');
      if (!send) return;
      const anchor = composerAnchor();
      const nearComposer = Boolean(button.closest?.('form, [data-testid*="composer"], [data-testid*="chat-input"]'))
        || Boolean(anchor && (anchor.contains(button) || anchor.parentElement?.contains(button)));
      if (nearComposer) interceptSend(event);
    }, true);
  }

  function setFileStatus(text, reset = false) {
    const status = root?.querySelector('[data-lj="file-status"]');
    if (!status) return;
    status.textContent = text;
    clearTimeout(fileStatusTimer);
    if (reset) {
      fileStatusTimer = setTimeout(() => {
        const current = root?.querySelector('[data-lj="file-status"]');
        if (current) current.textContent = 'PDF, Office, CSV, HTML, Markdown, or text. Up to 20 MB.';
      }, 10_000);
    }
  }

  async function convertFile(file) {
    if (!settings.lifejacketMode || !settings.lifejacketFileConversion) return;
    const extension = String(file?.name || '').split('.').pop().toLowerCase();
    if (!CONVERTIBLE_EXTENSIONS.has(extension)) {
      setFileStatus(`.${extension || 'unknown'} is not supported.`, true);
      return;
    }
    if (file.size > MAX_FILE_BYTES) {
      setFileStatus('That file is larger than 20 MB.', true);
      return;
    }
    setFileStatus(`Converting ${file.name} locally…`);
    try {
      let markdown;
      if (extension === 'txt' || extension === 'md') {
        markdown = await file.text();
      } else {
        const dataUrl = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result);
          reader.onerror = () => reject(reader.error || new Error('File read failed.'));
          reader.readAsDataURL(file);
        });
        const response = await chrome.runtime.sendMessage({ type: 'cuc:convert-file', dataUrl, ext: extension });
        if (!response?.ok) throw new Error(response?.error || 'Conversion failed.');
        markdown = String(response.markdown || '');
      }
      markdown = String(markdown || '').trim();
      if (!markdown) throw new Error('No extractable text was found.');
      if (markdown.length > MAX_MARKDOWN_CHARS) {
        markdown = `${markdown.slice(0, MAX_MARKDOWN_CHARS)}\n\n[truncated: converted text exceeded ${MAX_MARKDOWN_CHARS.toLocaleString()} characters]`;
      }
      const converted = `Converted from ${file.name}:\n\n${markdown}`;
      const existing = composerText();
      const combined = existing ? `${existing}\n\n${converted}` : converted;
      if (!setComposerText(combined)) throw new Error('The composer could not be updated.');
      setFileStatus(`${file.name} is now Markdown in the composer.`, true);
    } catch (error) {
      setFileStatus(`Could not convert ${file.name}: ${String(error?.message || error).slice(0, 120)}`, true);
    }
  }

  function wirePanel() {
    root.addEventListener('click', event => {
      const setting = event.target?.closest?.('[data-lj-setting]')?.getAttribute('data-lj-setting');
      if (setting) {
        const button = root.querySelector(`[data-lj-setting="${setting}"]`);
        if (button.disabled) return;
        saveSetting(setting, button.getAttribute('aria-checked') !== 'true').catch(() => {
          setPreviewStatus('Could not save the Lifejacket setting.', 'warning');
        });
        return;
      }
      const action = event.target?.closest?.('[data-lj-action]')?.getAttribute('data-lj-action');
      if (action === 'pick-file') {
        root.querySelector('[data-lj="file-input"]')?.click();
      } else if (action === 'send-optimized') {
        sendPreviewText(root.querySelector('[data-lj="optimized"]').value);
      } else if (action === 'send-original') {
        sendPreviewText(modalOriginal);
      } else if (action === 'cancel') {
        closePreview();
      }
    });
    root.addEventListener('keydown', event => {
      if (event.key === 'Escape' && modalOpen) closePreview();
    });
    const input = root.querySelector('[data-lj="file-input"]');
    input?.addEventListener('change', () => {
      const file = input.files?.[0];
      input.value = '';
      if (file) convertFile(file);
    });
    const fileButton = root.querySelector('[data-lj-action="pick-file"]');
    fileButton?.addEventListener('dragover', event => {
      event.preventDefault();
      fileButton.classList.add('lj-file-drag');
    });
    fileButton?.addEventListener('dragleave', () => fileButton.classList.remove('lj-file-drag'));
    fileButton?.addEventListener('drop', event => {
      event.preventDefault();
      fileButton.classList.remove('lj-file-drag');
      const file = event.dataTransfer?.files?.[0];
      if (file) convertFile(file);
    });
  }

  async function loadSettings() {
    const stored = await chrome.storage.local.get([SETTINGS_KEY]);
    settings = LIFEJACKET_SETTINGS.merge(stored[SETTINGS_KEY]);
    render();
  }

  function observeChanges() {
    chrome.storage.onChanged?.addListener((changes, area) => {
      if (area !== 'local' || !changes[SETTINGS_KEY]) return;
      settings = LIFEJACKET_SETTINGS.merge(changes[SETTINGS_KEY].newValue);
      render();
    });
    const mutationObserver = new MutationObserver(() => schedulePlacement());
    mutationObserver.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'data-theme', 'data-color-scheme'] });
    window.addEventListener('resize', schedulePlacement);
    window.addEventListener('popstate', schedulePlacement);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') schedulePlacement();
    });
  }

  async function boot() {
    await loadSettings();
    await ensurePanel();
    observeSends();
    observeChanges();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => boot().catch(() => {}), { once: true });
  } else {
    boot().catch(() => {});
  }
})();
