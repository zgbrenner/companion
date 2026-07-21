(() => {
  const CUC = globalThis.ClaudeUsageCompanion;
  const CAVEMAN = globalThis.ClaudeUsageCompanionCaveman;
  const PLATFORM = globalThis.CompanionPlatform;
  if (!CUC || !CAVEMAN || !PLATFORM) return;

  const USAGE_KEY = "cuc:openai-usage";
  const SETTINGS_KEY = "cuc:settings";
  const WIDGET_ID = "cuc-openai-widget";
  const FONT_STYLE_ID = "cuc-openai-font-face";
  const DROPZONE_DEFAULT = "Pick a file and convert it to lean Markdown locally";
  const CONVERTIBLE_EXTENSIONS = new Set(["pdf", "docx", "pptx", "xlsx", "odt", "odp", "ods", "rtf", "csv", "html", "htm", "md", "txt"]);
  const MAX_TEXT_CHARS = 800_000;
  const OPENAI_BUCKETS = new Set(["agentic", "five-hour", "daily", "seven-day", "monthly"]);
  const sessionFallbackKey = `new:${crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`}`;
  const eventToken = crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;

  let settings = { ...CUC.DEFAULT_SETTINGS };
  let widget = null;
  let widgetRoot = null;
  let usage = null;
  let surface = "chat";
  let generationActive = false;
  let modalOriginal = "";
  let modalOpen = false;
  let skipNextSend = false;
  let placementTimer = null;
  let widthObserver = null;
  let widthTarget = null;
  let dropzoneResetTimer = null;
  const widgetCssText = fetch(chrome.runtime.getURL("src/openai-widget.css"))
    .then(response => response.text())
    .catch(() => "");

  function injectFontFace() {
    if (document.getElementById(FONT_STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = FONT_STYLE_ID;
    style.textContent = `@font-face {
      font-family: "Space Grotesk";
      src: url("${chrome.runtime.getURL("src/fonts/space-grotesk-latin.woff2")}") format("woff2");
      font-weight: 400 700;
      font-display: swap;
    }`;
    (document.head || document.documentElement).appendChild(style);
  }

  async function loadState() {
    const stored = await chrome.storage.local.get([SETTINGS_KEY]);
    settings = CUC.mergeSettings(stored[SETTINGS_KEY]);
    try {
      const ephemeral = await chrome.storage.session.get([USAGE_KEY]);
      usage = ephemeral[USAGE_KEY] || null;
    } catch {
      const local = await chrome.storage.local.get([USAGE_KEY]);
      usage = local[USAGE_KEY] || null;
    }
  }

  function selectedModeText() {
    const selectors = [
      "header [aria-pressed='true']",
      "header [aria-selected='true']",
      "nav [aria-current='page']",
      "[data-testid*='mode'][aria-pressed='true']",
      "[data-testid*='mode'][data-state='active']",
      "[data-testid*='model'][aria-selected='true']",
    ];
    for (const selector of selectors) {
      const elements = document.querySelectorAll(selector);
      for (const element of elements) {
        const text = String(element.innerText || element.textContent || element.getAttribute("aria-label") || "").trim();
        if (/^(chat(?:gpt)?|work|codex)(?:\b|\s)/i.test(text)) return text;
      }
    }
    return "";
  }

  function detectSurface() {
    return PLATFORM.detectSurface({ url: location.href, selectedModeText: selectedModeText() }) || "chat";
  }

  function pageIsDark() {
    const root = document.documentElement;
    const markers = `${root.className || ""} ${root.getAttribute("data-theme") || ""} ${root.getAttribute("data-color-scheme") || ""}`.toLowerCase();
    if (/\bdark\b/.test(markers)) return true;
    if (/\blight\b/.test(markers)) return false;
    try {
      const bg = getComputedStyle(document.body).backgroundColor;
      const match = bg.match(/rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/);
      if (match) {
        const luminance = 0.2126 * Number(match[1]) + 0.7152 * Number(match[2]) + 0.0722 * Number(match[3]);
        return luminance < 128;
      }
    } catch { /* body may not exist yet */ }
    return Boolean(matchMedia?.("(prefers-color-scheme: dark)")?.matches);
  }

  function syncHostAppearance() {
    if (!widget) return;
    const nextSurface = detectSurface();
    surface = nextSurface;
    widget.classList.toggle("cuc-openai-dark", pageIsDark());
    for (const name of ["chat", "work", "codex"]) {
      widget.classList.toggle(`cuc-openai-surface-${name}`, nextSurface === name);
    }
    renderWidget();
  }

  const EDITABLE_SELECTORS = [
    "#prompt-textarea",
    "[data-testid='composer-input']",
    "[data-testid='prompt-textarea']",
    "form [contenteditable='true'][role='textbox']",
    "form textarea",
    "[data-testid*='composer'] [contenteditable='true']",
  ];

  function visible(element) {
    if (!element?.isConnected) return false;
    const rect = element.getBoundingClientRect?.();
    if (!rect || rect.width <= 0 || rect.height <= 0) return false;
    const style = getComputedStyle(element);
    return style.display !== "none" && style.visibility !== "hidden";
  }

  function findComposerEditable(preferActive = false) {
    if (preferActive) {
      const active = document.activeElement;
      if (active && (active.matches?.("textarea, [contenteditable='true'], [role='textbox']") || active.isContentEditable) && isInsideComposer(active)) {
        return active;
      }
    }
    for (const selector of EDITABLE_SELECTORS) {
      for (const candidate of document.querySelectorAll(selector)) {
        if (visible(candidate) && isInsideComposer(candidate, true)) return candidate;
      }
    }
    return null;
  }

  function findComposerAnchor() {
    const editable = EDITABLE_SELECTORS
      .flatMap(selector => Array.from(document.querySelectorAll(selector)))
      .find(visible);
    if (!editable) return null;
    return editable.closest("form, [data-testid*='composer'], [class*='composer']") || editable.parentElement || editable;
  }

  function isInsideComposer(element, allowUnresolvedAnchor = false) {
    if (!element) return false;
    const editable = element.closest?.("textarea, [contenteditable='true'], [role='textbox']") || (element.isContentEditable ? element : null);
    if (!editable) return false;
    if (editable.id === "prompt-textarea") return true;
    if (editable.closest("form, [data-testid*='composer'], [class*='composer']")) return true;
    if (!allowUnresolvedAnchor) {
      const anchor = findComposerAnchor();
      return Boolean(anchor && (anchor.contains(editable) || editable.contains(anchor)));
    }
    return false;
  }

  function saneDockCandidate(element) {
    if (!element || element === document.body || element === document.documentElement) return false;
    const rect = element.getBoundingClientRect?.();
    return Boolean(rect && rect.width >= 220 && rect.height > 0 && rect.height <= innerHeight * 0.42);
  }

  function visualComposerBox(anchor) {
    let node = anchor;
    let best = null;
    for (let depth = 0; depth < 8 && node && node !== document.body; depth += 1) {
      try {
        const style = getComputedStyle(node);
        const rounded = parseFloat(style.borderTopLeftRadius) >= 10;
        const bordered = style.borderTopStyle !== "none" && parseFloat(style.borderTopWidth) > 0;
        const surfaced = style.boxShadow !== "none"
          || (style.backgroundColor && !["transparent", "rgba(0, 0, 0, 0)"].includes(style.backgroundColor));
        if (rounded && (bordered || surfaced) && saneDockCandidate(node)) best = node;
      } catch { break; }
      node = node.parentElement;
    }
    return best;
  }

  function resolveDockTarget() {
    const anchor = findComposerAnchor();
    if (!anchor) return null;
    return visualComposerBox(anchor) || anchor;
  }

  function syncWidth(target) {
    if (!widget || !target) return;
    const apply = () => {
      if (!widget || !target.isConnected) return;
      const rect = target.getBoundingClientRect();
      if (rect.width > 0) widget.style.width = `${rect.width}px`;
    };
    if (widthTarget !== target) {
      widthObserver?.disconnect();
      widthObserver = new ResizeObserver(apply);
      widthObserver.observe(target);
      widthTarget = target;
    }
    apply();
  }

  function placeWidget() {
    if (!widget) return;
    const target = resolveDockTarget();
    if (!target?.parentElement) {
      if (widget.isConnected) widget.remove();
      return;
    }
    if (widget.previousElementSibling !== target || widget.parentElement !== target.parentElement) {
      try { target.parentElement.insertBefore(widget, target.nextSibling); }
      catch { return; }
    }
    syncWidth(target);
  }

  function schedulePlacement() {
    clearTimeout(placementTimer);
    placementTimer = setTimeout(() => {
      placeWidget();
      syncHostAppearance();
    }, 45);
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function formatNumber(value, maximumFractionDigits = 1) {
    return new Intl.NumberFormat(undefined, { maximumFractionDigits }).format(value);
  }

  function formatCounter(unit, used, limit) {
    if (unit === "usd") {
      const left = `$${Number(used).toFixed(2)}`;
      return limit ? `${left} / $${Number(limit).toFixed(2)}` : left;
    }
    const suffix = unit === "credits" ? " credits" : unit === "tokens" ? " tokens" : unit === "messages" ? " messages" : "";
    const left = `${formatNumber(used)}${suffix}`;
    return limit ? `${left} / ${formatNumber(limit)}${suffix}` : left;
  }

  function resetText(resetsAt) {
    const parsed = Date.parse(resetsAt || "");
    if (!Number.isFinite(parsed)) return "";
    const minutes = Math.round((parsed - Date.now()) / 60_000);
    if (minutes <= 0) return "reset pending";
    if (minutes < 60) return `resets in ${minutes}m`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `resets in ${hours}h ${minutes % 60}m`;
    return `resets in ${Math.floor(hours / 24)}d ${hours % 24}h`;
  }

  function rowHtml(bucket) {
    const pct = Math.max(0, Math.min(100, Number(bucket.pct) || 0));
    const level = pct >= 90 ? "danger" : pct >= 80 ? "warn" : "normal";
    const exact = bucket.used != null
      ? formatCounter(bucket.unit, bucket.used, bucket.limit)
      : `${formatNumber(bucket.pct)}%`;
    const reset = resetText(bucket.resetsAt);
    return `<div class="cuc-openai-row" data-level="${level}">
      <div class="cuc-openai-row-head">
        <span class="cuc-openai-label">${escapeHtml(bucket.label)}</span>
        <span class="cuc-openai-value">${escapeHtml(exact)}</span>
      </div>
      <div class="cuc-openai-progress" role="progressbar" aria-label="${escapeHtml(bucket.label)}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(pct)}" aria-valuetext="${Math.round(bucket.pct)} percent${reset ? `, ${escapeHtml(reset)}` : ""}">
        <span style="width:${pct}%"></span>
      </div>
      ${reset ? `<div class="cuc-openai-reset">${escapeHtml(reset)}</div>` : ""}
    </div>`;
  }

  function usageRows() {
    if (!usage) return [];
    const rows = Array.isArray(usage.buckets) ? usage.buckets.filter(bucket => OPENAI_BUCKETS.has(bucket.key)) : [];
    if (!rows.some(bucket => bucket.key === "agentic") && usage.counters?.credits?.used != null) {
      const counter = usage.counters.credits;
      rows.unshift({
        key: "agentic",
        label: "Agentic usage",
        pct: counter.limit ? (counter.used / counter.limit) * 100 : 0,
        resetsAt: counter.resetsAt || null,
        used: counter.used,
        limit: counter.limit,
        unit: "credits",
      });
    }
    return rows;
  }

  function renderWidget() {
    if (!widgetRoot || !widget) return;
    widget.style.display = settings.showWidget === false ? "none" : "block";
    const meta = PLATFORM.surfaceMeta(surface);
    const surfaceEl = widgetRoot.querySelector("[data-cuc-openai='surface']");
    if (surfaceEl) surfaceEl.innerHTML = `<span class="cuc-openai-dot" aria-hidden="true"></span>${escapeHtml(meta.label)}`;
    const live = widgetRoot.querySelector("[data-cuc-openai='live']");
    if (live) {
      live.textContent = generationActive ? "Working" : "Ready";
      live.dataset.active = generationActive ? "true" : "false";
    }

    const rows = usageRows();
    const rowsEl = widgetRoot.querySelector("[data-cuc-openai='rows']");
    if (rowsEl) {
      const tokenCounter = usage?.counters?.tokens;
      const tokenRow = tokenCounter && Number.isFinite(tokenCounter.total)
        ? `<div class="cuc-openai-row">
            <div class="cuc-openai-row-head"><span class="cuc-openai-label">Observed tokens</span><span class="cuc-openai-value">${escapeHtml(formatNumber(tokenCounter.total, 0))}</span></div>
            <div class="cuc-openai-reset">${tokenCounter.input != null ? `${escapeHtml(formatNumber(tokenCounter.input, 0))} in` : ""}${tokenCounter.input != null && tokenCounter.output != null ? " · " : ""}${tokenCounter.output != null ? `${escapeHtml(formatNumber(tokenCounter.output, 0))} out` : ""}</div>
          </div>`
        : "";
      rowsEl.innerHTML = rows.length || tokenRow
        ? `${rows.map(rowHtml).join("")}${tokenRow}`
        : `<div class="cuc-openai-empty">Waiting for native usage data from this account. Companion does not guess or scrape message text.</div>`;
    }

    const title = widgetRoot.querySelector("[data-cuc-openai='status-title']");
    const note = widgetRoot.querySelector("[data-cuc-openai='status-note']");
    if (title) title.textContent = usage ? `${meta.label} usage is connected` : `${meta.label} is ready`;
    if (note) {
      note.textContent = usage
        ? "Numbers shown here came from OpenAI's own first-party responses."
        : surface === "codex"
          ? "Codex-aware web surface detected. Native desktop shells cannot host a Chrome content script."
          : "Caveman Mode and local file conversion work immediately; usage appears only when OpenAI exposes it.";
    }

    const cavemanSection = widgetRoot.querySelector("[data-cuc-openai='caveman-section']");
    if (cavemanSection) cavemanSection.hidden = settings.showCavemanMode === false;
    const toggle = widgetRoot.querySelector("[data-cuc-openai-action='caveman-toggle']");
    if (toggle) toggle.setAttribute("aria-checked", settings.cavemanMode ? "true" : "false");
  }

  async function createWidget() {
    if (widget || !document.body) return;
    injectFontFace();
    widget = document.createElement("div");
    widget.id = WIDGET_ID;
    const shadow = widget.attachShadow({ mode: "open" });
    const cssText = await widgetCssText;
    let adopted = false;
    try {
      const sheet = new CSSStyleSheet();
      sheet.replaceSync(cssText);
      shadow.adoptedStyleSheets = [sheet];
      adopted = true;
    } catch { /* fallback below */ }
    if (!adopted) {
      const style = document.createElement("style");
      style.textContent = cssText;
      shadow.appendChild(style);
    }

    const root = document.createElement("div");
    root.className = "cuc-openai-root";
    root.innerHTML = `<section class="cuc-openai-card" role="complementary" aria-label="Companion for ChatGPT">
      <header class="cuc-openai-header">
        <div class="cuc-openai-brand">
          <span class="cuc-openai-mark" aria-hidden="true">◆</span>
          <span class="cuc-openai-title">Companion</span>
          <span class="cuc-openai-surface" data-cuc-openai="surface"></span>
        </div>
        <div class="cuc-openai-actions">
          <button class="cuc-openai-icon-button" data-cuc-openai-action="options" aria-label="Open Companion settings" title="Settings">⚙</button>
          <button class="cuc-openai-icon-button" data-cuc-openai-action="hide" aria-label="Hide Companion" title="Hide">×</button>
        </div>
      </header>
      <div class="cuc-openai-body">
        <div class="cuc-openai-status-line">
          <div class="cuc-openai-status-copy">
            <div class="cuc-openai-status-title" data-cuc-openai="status-title"></div>
            <div class="cuc-openai-status-note" data-cuc-openai="status-note"></div>
          </div>
          <span class="cuc-openai-live" data-cuc-openai="live" data-active="false">Ready</span>
        </div>
        <div class="cuc-openai-rows" data-cuc-openai="rows"></div>
        <div class="cuc-openai-caveman" data-cuc-openai="caveman-section">
          <div class="cuc-openai-caveman-head">
            <div class="cuc-openai-caveman-copy"><strong>Caveman Mode</strong><span>Shorter replies, local prompt trimming, lean file conversion</span></div>
            <button class="cuc-openai-switch" role="switch" data-cuc-openai-action="caveman-toggle" aria-label="Toggle Caveman Mode" aria-checked="false"></button>
          </div>
          <div class="cuc-openai-dropzone" data-cuc-openai="dropzone" role="button" tabindex="0">
            <span data-cuc-openai="dropzone-label">${DROPZONE_DEFAULT}</span>
            <input data-cuc-openai="dropzone-input" type="file" accept=".pdf,.docx,.pptx,.xlsx,.odt,.odp,.ods,.rtf,.csv,.html,.htm,.md,.txt" />
          </div>
        </div>
      </div>
    </section>
    <div class="cuc-openai-dialog" data-cuc-openai="trim-dialog" hidden>
      <div class="cuc-openai-dialog-card" role="dialog" aria-modal="true" aria-labelledby="cuc-openai-trim-title">
        <h2 id="cuc-openai-trim-title">Trim before sending</h2>
        <p>Everything happens locally. Review the shorter version, edit it, or send the original.</p>
        <textarea data-cuc-openai="trim-text" aria-label="Trimmed prompt"></textarea>
        <div class="cuc-openai-savings" data-cuc-openai="trim-savings"></div>
        <div class="cuc-openai-dialog-actions">
          <button class="cuc-openai-button" data-cuc-openai-action="cancel-trim">Cancel</button>
          <button class="cuc-openai-button" data-cuc-openai-action="send-original">Send original</button>
          <button class="cuc-openai-button cuc-openai-button-primary" data-cuc-openai-action="send-trimmed">Send trimmed</button>
        </div>
      </div>
    </div>`;
    shadow.appendChild(root);
    widgetRoot = shadow;
    wireWidgetActions();
    wireDropzone();
    syncHostAppearance();
    renderWidget();
    placeWidget();
  }

  async function saveSettings() {
    await chrome.storage.local.set({ [SETTINGS_KEY]: settings });
  }

  function wireWidgetActions() {
    widgetRoot.addEventListener("click", async event => {
      const action = event.target?.closest?.("[data-cuc-openai-action]")?.getAttribute("data-cuc-openai-action");
      if (!action) return;
      if (action === "options") chrome.runtime.sendMessage({ type: "cuc:openai-open-options" }).catch(() => {});
      if (action === "hide") {
        settings.showWidget = false;
        await saveSettings();
        renderWidget();
      }
      if (action === "caveman-toggle") {
        settings.cavemanMode = !settings.cavemanMode;
        await saveSettings();
        renderWidget();
      }
      if (action === "cancel-trim") closeTrimPreview();
      if (action === "send-original") sendFromPreview(modalOriginal);
      if (action === "send-trimmed") {
        const value = widgetRoot.querySelector("[data-cuc-openai='trim-text']")?.value || "";
        sendFromPreview(value);
      }
    });
  }

  function getComposerText() {
    const editable = findComposerEditable(true) || findComposerEditable();
    return String(editable?.value ?? editable?.innerText ?? editable?.textContent ?? "").trim();
  }

  function setComposerText(text) {
    const editable = findComposerEditable();
    if (!editable) return false;
    editable.focus();
    if (editable.tagName === "TEXTAREA") {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
      if (setter) setter.call(editable, text);
      else editable.value = text;
      editable.dispatchEvent(new Event("input", { bubbles: true }));
      return true;
    }
    const selection = getSelection();
    const range = document.createRange();
    range.selectNodeContents(editable);
    selection.removeAllRanges();
    selection.addRange(range);
    let inserted = false;
    try { inserted = document.execCommand("insertText", false, text); }
    catch { inserted = false; }
    if (!inserted) {
      editable.textContent = text;
      editable.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: text }));
    }
    return true;
  }

  function findSendButton() {
    const anchor = findComposerAnchor();
    const scope = anchor?.parentElement || document;
    return scope.querySelector?.("button[data-testid*='send']:not([disabled]), button[aria-label*='send' i]:not([disabled]), button[type='submit']:not([disabled])")
      || document.querySelector("button[data-testid*='send']:not([disabled]), button[aria-label*='send' i]:not([disabled]), form button[type='submit']:not([disabled])");
  }

  function conversationKey() {
    return PLATFORM.conversationIdFromUrl(location.href) || sessionFallbackKey;
  }

  async function claimCavemanInstruction() {
    try {
      const response = await chrome.runtime.sendMessage({
        type: "cuc:openai-claim-caveman-injection",
        conversationKey: conversationKey(),
      });
      return Boolean(response?.claimed);
    } catch {
      return false;
    }
  }

  function unclaimCavemanInstruction() {
    chrome.runtime.sendMessage({
      type: "cuc:openai-unclaim-caveman-injection",
      conversationKey: conversationKey(),
    }).catch(() => {});
  }

  function openTrimPreview(original) {
    if (!widgetRoot) return;
    modalOriginal = original;
    const compressed = CAVEMAN.compressPrompt(original);
    const text = widgetRoot.querySelector("[data-cuc-openai='trim-text']");
    const savings = widgetRoot.querySelector("[data-cuc-openai='trim-savings']");
    const dialog = widgetRoot.querySelector("[data-cuc-openai='trim-dialog']");
    if (text) text.value = compressed.text;
    if (savings) savings.textContent = compressed.changed ? `${compressed.savedPct}% shorter before the one-time mode instruction` : "Nothing safe to remove";
    if (dialog) dialog.hidden = false;
    modalOpen = true;
    setTimeout(() => text?.focus(), 0);
  }

  function closeTrimPreview() {
    const dialog = widgetRoot?.querySelector("[data-cuc-openai='trim-dialog']");
    if (dialog) dialog.hidden = true;
    modalOpen = false;
  }

  async function sendFromPreview(body) {
    const clean = String(body || "").trim();
    if (!clean) return;
    closeTrimPreview();
    const claimed = await claimCavemanInstruction();
    const finalText = claimed ? `${CAVEMAN.CAVEMAN_INSTRUCTION}\n\n${clean}` : clean;
    if (!setComposerText(finalText)) {
      if (claimed) unclaimCavemanInstruction();
      return;
    }
    await new Promise(resolve => setTimeout(resolve, 120));
    skipNextSend = true;
    const button = findSendButton();
    if (button) {
      button.click();
      return;
    }
    const editable = findComposerEditable();
    if (!editable) {
      skipNextSend = false;
      if (claimed) unclaimCavemanInstruction();
      return;
    }
    editable.dispatchEvent(new KeyboardEvent("keydown", {
      key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true, cancelable: true,
    }));
  }

  function interceptSend(event) {
    if (skipNextSend) {
      skipNextSend = false;
      return;
    }
    if (!settings.cavemanMode || settings.showCavemanMode === false || modalOpen) return;
    if (event.type === "keydown") {
      if (event.key !== "Enter" || event.shiftKey || event.isComposing) return;
      if (!isInsideComposer(event.target)) return;
    } else if (event.type === "click") {
      const button = event.target?.closest?.("button");
      if (!button) return;
      const label = `${button.getAttribute("aria-label") || ""} ${button.getAttribute("data-testid") || ""} ${button.textContent || ""}`.toLowerCase();
      if (!/send|submit/.test(label) && !button.matches("button[type='submit']")) return;
      const anchor = findComposerAnchor();
      if (!anchor || !(anchor.contains(button) || anchor.parentElement?.contains(button))) return;
    }
    const original = getComposerText();
    if (!original) return;
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation?.();
    openTrimPreview(original);
  }

  function setDropzoneLabel(message, reset = false) {
    const element = widgetRoot?.querySelector("[data-cuc-openai='dropzone-label']");
    if (!element) return;
    element.textContent = message;
    clearTimeout(dropzoneResetTimer);
    if (reset) dropzoneResetTimer = setTimeout(() => { element.textContent = DROPZONE_DEFAULT; }, 10_000);
  }

  async function convertFile(file) {
    const extension = (file.name.split(".").pop() || "").toLowerCase();
    if (!CONVERTIBLE_EXTENSIONS.has(extension)) {
      setDropzoneLabel(`Unsupported .${extension} file`, true);
      return;
    }
    if (file.size > 20 * 1024 * 1024) {
      setDropzoneLabel("File is larger than 20 MB", true);
      return;
    }
    setDropzoneLabel(`Converting ${file.name} locally…`);
    try {
      let markdown;
      if (extension === "txt" || extension === "md") {
        markdown = await file.text();
        if (markdown.length > MAX_TEXT_CHARS) markdown = `${markdown.slice(0, MAX_TEXT_CHARS)}\n\n… [truncated]`;
      } else {
        const dataUrl = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result);
          reader.onerror = () => reject(reader.error || new Error("read failed"));
          reader.readAsDataURL(file);
        });
        const response = await chrome.runtime.sendMessage({ type: "cuc:openai-convert-file", dataUrl, ext: extension });
        if (!response?.ok || !String(response.markdown || "").trim()) throw new Error(response?.error || "no text found");
        markdown = response.markdown;
      }
      const result = `Converted from ${file.name}:\n\n${String(markdown).trim()}`;
      if (!setComposerText(result)) throw new Error("chat composer not found");
      setDropzoneLabel(`✓ ${file.name} added as Markdown`, true);
    } catch (error) {
      setDropzoneLabel(`Could not convert ${file.name}: ${String(error?.message || error).slice(0, 90)}`, true);
    }
  }

  function wireDropzone() {
    const dropzone = widgetRoot.querySelector("[data-cuc-openai='dropzone']");
    const input = widgetRoot.querySelector("[data-cuc-openai='dropzone-input']");
    if (!dropzone || !input) return;
    const pick = () => input.click();
    dropzone.addEventListener("click", event => { if (event.target !== input) pick(); });
    dropzone.addEventListener("keydown", event => {
      if (event.key === "Enter" || event.key === " ") { event.preventDefault(); pick(); }
    });
    input.addEventListener("change", () => {
      const file = input.files?.[0];
      input.value = "";
      if (file) convertFile(file);
    });
    dropzone.addEventListener("dragover", event => { event.preventDefault(); event.stopPropagation(); dropzone.dataset.drag = "true"; });
    dropzone.addEventListener("dragleave", () => { dropzone.dataset.drag = "false"; });
    dropzone.addEventListener("drop", event => {
      event.preventDefault();
      event.stopPropagation();
      dropzone.dataset.drag = "false";
      const file = event.dataTransfer?.files?.[0];
      if (file) convertFile(file);
    });
  }

  function safeSnapshot(raw) {
    if (!raw || raw.provider !== "openai" || !Number.isFinite(raw.observedAt)) return null;
    const buckets = (Array.isArray(raw.buckets) ? raw.buckets : [])
      .filter(bucket => bucket && OPENAI_BUCKETS.has(bucket.key) && Number.isFinite(bucket.pct) && bucket.pct >= 0 && bucket.pct <= 1000)
      .slice(0, 8)
      .map(bucket => ({
        key: bucket.key,
        label: String(bucket.label || "Usage").slice(0, 80),
        pct: bucket.pct,
        resetsAt: typeof bucket.resetsAt === "string" ? bucket.resetsAt : null,
        used: Number.isFinite(bucket.used) ? bucket.used : null,
        limit: Number.isFinite(bucket.limit) ? bucket.limit : null,
        unit: ["credits", "usd", "tokens", "messages"].includes(bucket.unit) ? bucket.unit : null,
      }));
    const counters = {};
    for (const key of ["credits", "usd", "messages"]) {
      const counter = raw.counters?.[key];
      if (counter && Number.isFinite(counter.used) && counter.used >= 0) {
        counters[key] = {
          used: counter.used,
          limit: Number.isFinite(counter.limit) && counter.limit > 0 ? counter.limit : null,
          resetsAt: typeof counter.resetsAt === "string" ? counter.resetsAt : null,
        };
      }
    }
    const tokens = raw.counters?.tokens;
    if (tokens && [tokens.input, tokens.output, tokens.total].some(Number.isFinite)) {
      counters.tokens = {
        input: Number.isFinite(tokens.input) ? tokens.input : null,
        output: Number.isFinite(tokens.output) ? tokens.output : null,
        total: Number.isFinite(tokens.total) ? tokens.total : null,
      };
    }
    if (!buckets.length && !Object.keys(counters).length) return null;
    return {
      provider: "openai",
      observedAt: raw.observedAt,
      sourcePath: typeof raw.sourcePath === "string" ? raw.sourcePath.slice(0, 240) : null,
      maxUtilizationPct: buckets.length ? Math.max(...buckets.map(bucket => bucket.pct)) : null,
      buckets,
      counters,
    };
  }

  function reportUsage(snapshot) {
    chrome.runtime.sendMessage({
      type: "cuc:openai-usage-updated",
      surface,
      observedAt: snapshot.observedAt,
      sourcePath: snapshot.sourcePath,
      maxUtilizationPct: snapshot.maxUtilizationPct,
      buckets: snapshot.buckets,
      counters: snapshot.counters,
    }).catch(() => {});
  }

  function offerToken() {
    window.dispatchEvent(new CustomEvent("cuc:openai-token-offer", { detail: { token: eventToken } }));
  }

  function startEventBridge() {
    window.addEventListener("cuc:openai-main-ready", offerToken);
    window.addEventListener("cuc:openai-usage-snapshot", event => {
      if (event?.detail?.token !== eventToken) return;
      const snapshot = safeSnapshot(event.detail.snapshot);
      if (!snapshot) return;
      usage = snapshot;
      renderWidget();
      reportUsage(snapshot);
    });
    window.addEventListener("cuc:openai-network-event", event => {
      if (event?.detail?.token !== eventToken) return;
      const kind = event.detail.kind;
      if (kind === "generation-start") generationActive = true;
      if (kind === "generation-complete") generationActive = false;
      renderWidget();
    });
    offerToken();
  }

  function installObservers() {
    const observer = new MutationObserver(schedulePlacement);
    observer.observe(document.documentElement, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ["class", "style", "data-theme", "data-color-scheme", "aria-pressed", "aria-selected", "aria-current", "data-state"],
    });
    addEventListener("popstate", schedulePlacement);
    addEventListener("hashchange", schedulePlacement);
    addEventListener("resize", schedulePlacement, { passive: true });
    document.addEventListener("keydown", interceptSend, true);
    document.addEventListener("click", interceptSend, true);
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === "local" && changes[SETTINGS_KEY]) {
        settings = CUC.mergeSettings(changes[SETTINGS_KEY].newValue);
        renderWidget();
      }
    });
  }

  async function start() {
    startEventBridge();
    await loadState();
    if (document.readyState === "loading") {
      await new Promise(resolve => document.addEventListener("DOMContentLoaded", resolve, { once: true }));
    }
    await createWidget();
    installObservers();
    schedulePlacement();
  }

  start().catch(() => {});
})();
