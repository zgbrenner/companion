(() => {
  const CUC = globalThis.ClaudeUsageCompanion;
  const CUCNative = globalThis.ClaudeUsageCompanionNative;
  const CAVEMAN = globalThis.ClaudeUsageCompanionCaveman;
  let settings = { ...CUC.DEFAULT_SETTINGS };
  let widget = null;      // shadow HOST element (docked in page flow)
  let widgetRoot = null;  // shadow root; null until the widget is fully built
  // The widget renders inside a shadow root so claude.ai's global styles
  // can't bleed into it (and its styles can't leak out). Start fetching the
  // shadow stylesheet immediately; it's a bundled extension file.
  const widgetCssText = fetch(chrome.runtime.getURL("src/widget.css"))
    .then(response => response.text())
    .catch(() => "");
  let nativeUsage = null;
  let nativeUsageError = null;
  let nativeUsageTimer = null;
  let nativeUsageBackoffMs = null;
  // Recent (timestamp, session-limit %) samples shared across tabs via the
  // ephemeral store; feeds the "at this pace…" projection.
  let paceSamples = [];
  let lastUsageSnapshotRefreshAt = 0;
  // Real-spend state, written by the background single-writer from the
  // samples this (and every other) tab reports:
  //   spendSession — {baselineUsd, lastUsd, monthKey, startedAt} in
  //                  storage.session; "spent this session" = lastUsd − baseline.
  //   spendDays    — {days: {date: {startUsd, endUsd}}} in storage.local;
  //                  powers the "Today" line, popup trend, and CSV export.
  let spendSession = null;
  let spendDays = null;
  // Per-model daily breakdown learned from claude.ai's own Settings → Usage
  // page (see fetchSpendBreakdown in native-usage.js). Null until claude.ai
  // reveals the endpoint and it validates.
  let spendBreakdown = null;
  let generationRefreshTimer = null;
  // League Spartan registration for the widget. @font-face declared INSIDE a
  // shadow root's stylesheet never registers with the document font cache
  // (a shadow root can use fonts, but can't define new ones), so it has to
  // be injected once into the host page's <head> instead. Guarded by id so
  // repeated createWidget() calls (SPA re-mounts, multiple invocations)
  // can't stack duplicate <style> tags.
  const FONT_FACE_STYLE_ID = "cuc-font-face";
  function injectFontFace() {
    if (document.getElementById(FONT_FACE_STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = FONT_FACE_STYLE_ID;
    style.textContent = `@font-face {
      font-family: "League Spartan";
      src: url("${chrome.runtime.getURL("src/fonts/league-spartan-bold.woff2")}") format("woff2");
      font-weight: 400 700;
      font-display: swap;
    }`;
    (document.head || document.documentElement).appendChild(style);
  }
  // Caveman Mode state. cavemanInjectedMap mirrors the background-owned
  // "instruction already sent to this conversation" map (persisted, so it
  // survives page reloads within the same chat). responsesSinceInjection is
  // per-tab: counts assistant responses since the instruction/reminder was
  // last pinned, driving the every-Nth-message reminder.
  let cavemanInjectedMap = {};
  let cavemanPendingMark = false; // instruction rode along with the first message of a new chat
  let skipNextSendIntercept = false;
  let cavemanModalOpen = false;
  const responsesSinceInjection = new Map();
  const NATIVE_USAGE_REFRESH_MS = 60 * 1000;
  const NATIVE_USAGE_MAX_BACKOFF_MS = 10 * 60 * 1000;

  // +/-20% jitter so multiple tabs polling the same account don't all hit the
  // usage endpoint in lockstep every 60s. Also used to jitter backoff delays
  // (see scheduleNextNativeUsagePoll) so tabs that got 429'd together don't
  // retry in lockstep at 120s/240s/480s either.
  function jitterMs(baseMs) {
    const jitterFactor = 1 + (Math.random() * 0.4 - 0.2);
    return Math.round(baseMs * jitterFactor);
  }

  function jitteredNativeUsageInterval() {
    return jitterMs(NATIVE_USAGE_REFRESH_MS);
  }

  // Per-conversation network-detected model. A single global would mean that
  // once any chat's request revealed a model (e.g. Opus), every OTHER
  // conversation in the tab inherited that same model forever. Map insertion
  // order gives a cheap FIFO for the size cap below.
  let networkModelByConversation = new Map();
  const MAX_MODEL_MAP_ENTRIES = 20;

  function setNetworkModelForConversation(conversationId, modelKey) {
    if (!modelKey) return;
    const key = conversationId || CUC.currentConversationId();
    networkModelByConversation.delete(key);
    networkModelByConversation.set(key, modelKey);
    while (networkModelByConversation.size > MAX_MODEL_MAP_ENTRIES) {
      const oldestKey = networkModelByConversation.keys().next().value;
      networkModelByConversation.delete(oldestKey);
    }
  }

  // Random handshake token offered to the MAIN-world network watcher
  // (src/injected.js, a manifest-declared world:"MAIN" content script) via a
  // DOM event. Events arriving on the page-global bus without this token are
  // ignored, so an arbitrary page script can't forge events. Both content
  // scripts run at document_start — before ANY page script — so the first
  // offer the watcher sees is guaranteed to be ours; the offer is repeated on
  // "cuc:main-ready" because Chrome doesn't guarantee which world's content
  // script runs first.
  const NETWORK_EVENT_TOKEN = (crypto?.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`);

  function offerNetworkToken() {
    window.dispatchEvent(new CustomEvent("cuc:token-offer", { detail: { token: NETWORK_EVENT_TOKEN } }));
  }

  function startNetworkTokenHandshake() {
    window.addEventListener("cuc:main-ready", offerNetworkToken);
    offerNetworkToken();
  }

  async function loadState() {
    const stored = await chrome.storage.local.get(["cuc:settings", "cuc:spend-days", "cuc:caveman-injected"]);
    settings = CUC.mergeSettings(stored["cuc:settings"]);
    spendDays = stored["cuc:spend-days"] || null;
    cavemanInjectedMap = stored["cuc:caveman-injected"] || {};
    const ephemeral = await CUC.ephemeralGet(["cuc:spend-session", "cuc:spend-breakdown"]);
    spendSession = ephemeral["cuc:spend-session"] || null;
    spendBreakdown = ephemeral["cuc:spend-breakdown"] || null;
  }

  function detectModelKey() {
    // Prefer the model this specific conversation's own network requests
    // revealed. Falling through to DOM/default (rather than some OTHER
    // conversation's cached model) when this conversation has no entry yet
    // is what keeps a freshly-opened chat from showing a stale model.
    const networkModel = networkModelByConversation.get(CUC.currentConversationId());
    if (networkModel) return networkModel;
    // Prefer a scoped model-picker control if we can find one — scanning the
    // whole page for words like "opus" or "haiku" produces false positives
    // when those words appear in chat history rather than an active selector.
    const pickerSelectors = [
      "[data-testid='model-selector-dropdown']",
      "[data-testid*='model-selector']",
      "[data-testid*='model-picker']",
      "[aria-label*='model' i] [aria-selected='true']",
      "button[aria-haspopup='listbox'][aria-label*='model' i]"
    ];
    for (const selector of pickerSelectors) {
      const el = document.querySelector(selector);
      const text = el?.innerText || el?.getAttribute?.("aria-label") || "";
      const detected = CUC.detectModelFromText(text);
      if (detected) return detected;
    }
    // Fall back to a narrow scan of the page header/toolbar area only, not
    // the full body, to avoid picking up model names mentioned in messages.
    const header = document.querySelector("header")?.innerText || "";
    return CUC.detectModelFromText(header) || settings.defaultModel;
  }

  // The widget follows claude.ai's OWN theme (what the user picked in Claude's
  // appearance settings), not the OS preference — a dark-OS user running
  // Claude in light mode gets a light widget. Claude tags dark mode on the
  // <html> element (class "dark" today; data attributes checked in case that
  // markup drifts); when no explicit marker is present, fall back to sampling
  // the page's actual rendered background color so the widget still matches
  // whatever is really on screen.
  function pageIsDarkMode() {
    const root = document.documentElement;
    const markers = `${root.className || ""} ${root.getAttribute("data-theme") || ""} ${root.getAttribute("data-mode") || ""}`.toLowerCase();
    if (/\bdark\b/.test(markers)) return true;
    if (/\blight\b/.test(markers)) return false;
    try {
      const bg = getComputedStyle(document.body).backgroundColor;
      const rgb = bg.match(/rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/);
      if (rgb) {
        const luminance = 0.2126 * rgb[1] + 0.7152 * rgb[2] + 0.0722 * rgb[3];
        return luminance < 128;
      }
    } catch {
      // Detached body or unparsable color — fall through to the OS hint.
    }
    return Boolean(window.matchMedia?.("(prefers-color-scheme: dark)")?.matches);
  }

  // Mirror the detected theme onto the shadow host as .cuc-dark — a shadow
  // tree's CSS can't match ancestors past its host, so widget.css keys every
  // dark rule off :host(.cuc-dark). Light is the default.
  function syncWidgetDarkMode() {
    if (!widget) return;
    widget.classList.toggle("cuc-dark", pageIsDarkMode());
  }

  function observeDarkMode() {
    const observer = new MutationObserver(syncWidgetDarkMode);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class", "data-theme", "data-mode", "style"] });
    if (document.body) {
      observer.observe(document.body, { attributes: true, attributeFilter: ["class", "style"] });
    }
  }

  async function createWidget() {
    if (widget || !document.body) return;
    injectFontFace();
    widget = document.createElement("div");
    widget.id = "cuc-widget";
    const shadow = widget.attachShadow({ mode: "open" });

    const cssText = await widgetCssText;
    let styled = false;
    try {
      const sheet = new CSSStyleSheet();
      sheet.replaceSync(cssText);
      shadow.adoptedStyleSheets = [sheet];
      styled = true;
    } catch {
      // Constructable stylesheets unavailable — fall through to a <style> tag.
    }
    if (!styled) {
      const style = document.createElement("style");
      style.textContent = cssText;
      shadow.appendChild(style);
    }

    const container = document.createElement("div");
    container.className = "cuc-root";
    const nativeRow = (key, label, hint) => `
      <div class="cuc-native-row" data-cuc="row-${key}" hidden>
        <div class="cuc-native-label">
          <span title="${hint}">${label}</span>
          <span data-cuc="${key}-value">—</span>
        </div>
        <div class="cuc-progress cuc-progress--thin" role="progressbar" aria-label="${label}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0">
          <div class="cuc-progress-bar" data-cuc="${key}-bar"></div>
        </div>
      </div>
    `;
    container.innerHTML = `
      <div class="cuc-card" role="complementary" aria-label="Claude usage meter">
        <div class="cuc-header">
          <div class="cuc-brand"><span class="cuc-orbit-mark" aria-hidden="true"><svg viewBox="0 0 128 128" focusable="false" aria-hidden="true"><rect width="128" height="128" rx="28" fill="#111827"></rect><path d="M91.4 35.8A42 42 0 1 0 94.6 88" fill="none" stroke="#F8FAFC" stroke-width="11" stroke-linecap="round"></path><circle cx="64" cy="64" r="15" fill="#35D6A6"></circle><circle cx="94.6" cy="88" r="5.5" fill="#35D6A6"></circle></svg></span><span class="cuc-title">COMPANION</span></div>
          <div class="cuc-controls">
            <button class="cuc-button" data-cuc-action="cycle" title="Switch between dollars/tokens" aria-label="Switch display between dollars, tokens, and both">$</button>
            <button class="cuc-button" data-cuc-action="options" title="Settings" aria-label="Open settings">⚙</button>
            <button class="cuc-button" data-cuc-action="hide" title="Hide" aria-label="Hide usage widget">✕</button>
          </div>
        </div>
        <div class="cuc-body" data-cuc="body">
          <div class="cuc-meter" data-cuc="meter">
            <div class="cuc-meter-label">
              <span title="Your real usage-credit spend since you opened your browser — read straight from Claude's own monthly counter, accurate to the cent. Covers ALL your Claude activity in that time (every tab and device on your account), not just this chat. Token figures are a range derived from this real spend using current Anthropic pricing.">Spent this session<span class="cuc-sr-only"> — real usage-credit spend since the browser opened, from Claude's own counter, covering all activity on your account</span></span>
              <span data-cuc="session-value">—</span>
            </div>
            <div class="cuc-progress" role="progressbar" aria-label="Session spend as a share of the monthly allowance" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0">
              <div class="cuc-progress-bar" data-cuc="session-bar"></div>
            </div>
            <div class="cuc-budget-line" data-cuc="session-detail" hidden></div>
            <div class="cuc-budget-line" data-cuc="week-detail" hidden></div>
          </div>

          <div class="cuc-native" data-cuc="native-section">
            ${nativeRow("five-hour", "Session limit (5-hour)", "How much of your rolling 5-hour Claude allowance you've used. This is the limit that pauses you mid-day. Read from Claude directly — not an estimate.")}
            ${nativeRow("seven-day", "Weekly limit", "Your 7-day Claude allowance across all models. Read from Claude directly — not an estimate.")}
            ${nativeRow("opus", "Weekly Opus limit", "Your 7-day allowance for the Opus model specifically. Only shown once you've used Opus this week.")}
            <div class="cuc-native-row" data-cuc="row-enterprise" hidden>
              <div class="cuc-native-label">
                <span title="Monthly usage-credit spend and cap from Claude.ai — real account data, not an estimate.">Monthly allowance</span>
                <span data-cuc="enterprise-value">—</span>
              </div>
              <div class="cuc-progress cuc-progress--thin" role="progressbar" aria-label="Monthly allowance" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0">
                <div class="cuc-progress-bar" data-cuc="enterprise-bar"></div>
              </div>
            </div>
            <div class="cuc-native-note" data-cuc="enterprise-note" aria-live="polite">Loading Claude usage…</div>
          </div>

          <div class="cuc-tip" data-cuc="tip" aria-live="polite" hidden></div>

          <div class="cuc-caveman-row" data-cuc="caveman-row">
            <span class="cuc-caveman-label" title="Caveman Mode saves your Claude quota: Claude answers ultra-brief, your prompts get trimmed (you approve a preview first), and dropped files convert to lean Markdown.">🪨 Caveman Mode — stretch your quota</span>
            <span class="cuc-sr-only" id="cuc-desc-caveman">Saves your Claude quota: Claude answers ultra-brief, your prompts get trimmed with a preview you approve first, and dropped files convert to lean Markdown.</span>
            <button class="cuc-switch" data-cuc-action="caveman-toggle" role="switch" aria-checked="false" aria-label="Toggle Caveman Mode" aria-describedby="cuc-desc-caveman"><span class="cuc-switch-knob"></span></button>
          </div>
          <div class="cuc-dropzone" data-cuc="dropzone" role="button" tabindex="0" hidden>
            <span data-cuc="dropzone-label" aria-live="polite">Click to pick a file → Markdown (fewer tokens than raw files)</span>
            <input type="file" data-cuc="dropzone-input" accept=".pdf,.docx,.pptx,.xlsx,.odt,.odp,.ods,.rtf,.csv,.html,.htm,.md,.txt" hidden />
          </div>
        </div>
      </div>
    `;

    shadow.appendChild(container);
    // Only now is the widget fully built — renders that raced the CSS fetch
    // bail on widgetRoot being null and re-run on the next state change.
    widgetRoot = shadow;

    syncWidgetDarkMode();
    observeDarkMode();
    placeWidget();

    // Attached inside the shadow root, so event.target is the real internal
    // element (retargeting only applies to listeners outside the root).
    container.addEventListener("click", async event => {
      const action = event.target?.closest?.("[data-cuc-action]")?.getAttribute("data-cuc-action");
      if (!action) return;
      if (action === "hide") {
        settings.showWidget = false;
        await chrome.storage.local.set({ "cuc:settings": settings });
        renderWidget();
      }
      if (action === "options") {
        chrome.runtime.sendMessage({ type: "cuc:open-options" });
      }
      if (action === "cycle") {
        // Same table the button's aria-label is rendered from, so the
        // announced "next" and the actual next can never disagree.
        settings.displayMode = DISPLAY_MODE_NEXT[settings.displayMode] || "dollars";
        await chrome.storage.local.set({ "cuc:settings": settings });
        renderWidget();
      }
      if (action === "caveman-toggle") {
        settings.cavemanMode = !settings.cavemanMode;
        await chrome.storage.local.set({ "cuc:settings": settings });
        renderWidget();
        // Flipping ON inside an existing chat sends the instruction now;
        // brand-new chats get it prepended to their first message instead.
        if (settings.cavemanMode) maybeInjectCavemanInstruction();
      }
    });
    wireDropzone(container);
    renderWidget();
  }

  const COMPOSER_ANCHOR_SELECTORS = [
    "[data-testid='chat-input-grid-container']",
    "[data-testid*='chat-input']",
    "[data-testid*='composer']",
    "form:has(textarea)",
    "form:has([contenteditable='true'])"
  ];

  // ---- Caveman Mode ---------------------------------------------------------
  // See src/caveman.js for the architecture decision (direct injection),
  // instruction wording rationale, and the compressor. This section is the
  // DOM side: reading/writing the composer, injecting the instruction once
  // per conversation, intercepting sends for the trim-preview, and the
  // file → Markdown drop zone.

  const COMPOSER_EDITABLE_SELECTOR = "div[contenteditable='true'], textarea, [role='textbox']";

  // preferActive: when the user is mid-send, the element they typed into is
  // the focused one — read THAT, not whatever the anchor search finds first.
  // The old search-only path could return a different (empty) editable, so
  // getComposerText() came back "" and the send interceptor let the message
  // through untrimmed. This is the primary fix for "trimming never happens".
  function findComposerEditable(preferActive = false) {
    if (preferActive) {
      const active = document.activeElement;
      const activeEditable = active?.matches?.(COMPOSER_EDITABLE_SELECTOR)
        ? active
        : (active?.isContentEditable ? active : active?.closest?.(COMPOSER_EDITABLE_SELECTOR));
      // Only trust the focused element when it actually belongs to the chat
      // composer — claude.ai has other editables (rename fields, project
      // instructions) whose text must never be read as "the draft".
      if (activeEditable && isInsideComposer(activeEditable)) return activeEditable;
    }
    const anchor = findComposerAnchor();
    const scope = anchor?.closest?.("form, [data-testid*='composer']") || anchor || document.body;
    return scope?.querySelector?.(COMPOSER_EDITABLE_SELECTOR)
      || document.querySelector("div[contenteditable='true'], textarea");
  }

  function getComposerText() {
    const el = findComposerEditable(true);
    return String(el?.value ?? el?.innerText ?? "").trim();
  }

  function setComposerText(text) {
    const el = findComposerEditable();
    if (!el) return false;
    el.focus();
    if (el.tagName === "TEXTAREA") {
      // Go through the prototype setter so React's value tracking notices.
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
      if (setter) setter.call(el, text);
      else el.value = text;
      el.dispatchEvent(new Event("input", { bubbles: true }));
      return true;
    }
    // ProseMirror contenteditable: select-all + insertText runs through the
    // editor's own input handling, producing a real editor transaction.
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(el);
    selection.removeAllRanges();
    selection.addRange(range);
    let inserted = false;
    try {
      inserted = document.execCommand("insertText", false, text);
    } catch {
      inserted = false;
    }
    if (!inserted) {
      el.textContent = text;
      el.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: text }));
    }
    return true;
  }

  function findSendButton() {
    const anchor = findComposerAnchor();
    const scope = anchor?.closest?.("form, [data-testid*='composer']")?.parentElement || document;
    return scope.querySelector?.("button[aria-label*='send' i]:not([disabled])")
      || document.querySelector("button[aria-label*='send' i]:not([disabled])")
      || document.querySelector("form button[type='submit']:not([disabled])");
  }

  // True only for editables that are part of the actual chat composer.
  // Matching any textarea/contenteditable on the page (the old behavior) let
  // the send interceptor fire from unrelated fields — e.g. Enter in a
  // conversation-rename box would open the trim preview with THAT field's
  // text and, on confirm, send it as a chat message.
  function isInsideComposer(el) {
    if (!el) return false;
    const editable = el.closest?.(COMPOSER_EDITABLE_SELECTOR)
      || (el.isContentEditable ? el : null);
    if (!editable) return false;
    const anchor = findComposerAnchor();
    if (anchor && (anchor.contains(editable) || editable.contains(anchor))) return true;
    return Boolean(editable.closest?.("[data-testid*='composer'], [data-testid*='chat-input']"));
  }

  // Type `text` into the composer and trigger claude.ai's own send. The
  // skip flag lets our synthetic click/Enter pass the interceptor untouched.
  async function sendComposerMessage(text) {
    if (!setComposerText(text)) return false;
    // Give the editor a beat to settle so the send button enables.
    await new Promise(resolve => setTimeout(resolve, 150));
    skipNextSendIntercept = true;
    const button = findSendButton();
    if (button) {
      button.click();
      return true;
    }
    const editable = findComposerEditable();
    if (!editable) {
      skipNextSendIntercept = false;
      return false;
    }
    editable.dispatchEvent(new KeyboardEvent("keydown", {
      key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true, cancelable: true
    }));
    return true;
  }

  // Atomic "instruction already sent to this chat?" — the background is the
  // single writer, so two tabs on the same conversation can't both inject.
  async function claimCavemanInjection(conversationId) {
    try {
      const response = await chrome.runtime.sendMessage({ type: "cuc:claim-caveman-injection", conversationId });
      return Boolean(response?.claimed);
    } catch {
      return false;
    }
  }

  function unclaimCavemanInjection(conversationId) {
    delete cavemanInjectedMap[conversationId];
    try {
      chrome.runtime.sendMessage({ type: "cuc:unclaim-caveman-injection", conversationId }).catch(() => {});
    } catch {
      // Local removal already done; a stale claim just means one skipped re-inject.
    }
  }

  function cavemanNeedsInstruction(conversationId) {
    return !cavemanInjectedMap[conversationId];
  }

  // Standalone instruction turn for a conversation that already exists.
  // Brand-new chats are handled by the send interceptor instead (the
  // instruction is prepended to the first message, avoiding a wasted turn).
  async function maybeInjectCavemanInstruction() {
    if (settings.showCavemanMode === false || !settings.cavemanMode || !CAVEMAN) return;
    const conversationId = CUC.currentConversationId();
    if (conversationId === "home-or-new-chat") return;
    if (!cavemanNeedsInstruction(conversationId)) return;
    if (!(await claimCavemanInjection(conversationId))) return;
    cavemanInjectedMap[conversationId] = Date.now();
    responsesSinceInjection.set(conversationId, 0);
    const draft = getComposerText();
    const sent = await sendComposerMessage(CAVEMAN.CAVEMAN_INSTRUCTION);
    if (!sent) {
      unclaimCavemanInjection(conversationId);
      return;
    }
    // Put the user's unsent draft back once the instruction has gone out —
    // wait for the composer to actually empty (the editor clears it when the
    // send lands) instead of a fixed timeout, and never overwrite text the
    // person typed in the meantime.
    if (draft) restoreDraftWhenComposerClears(draft);
  }

  function restoreDraftWhenComposerClears(draft, { intervalMs = 300, timeoutMs = 6000 } = {}) {
    const startedAt = Date.now();
    const tick = () => {
      const current = getComposerText();
      if (!current) {
        setComposerText(draft);
        return;
      }
      // Still showing the instruction (or something new the user typed):
      // only keep waiting while it's our own instruction text in there.
      if (Date.now() - startedAt >= timeoutMs) return;
      if (current !== CAVEMAN.CAVEMAN_INSTRUCTION) return; // user typed — leave it alone
      setTimeout(tick, intervalMs);
    };
    setTimeout(tick, intervalMs);
  }

  // What must ride along with the NEXT outgoing message: the full instruction
  // (first message of this conversation under Caveman Mode) or the short
  // reminder (every Nth response — long chats get compacted and early
  // instructions lose salience, per Anthropic's own docs).
  function cavemanPrefixForNextSend() {
    const conversationId = CUC.currentConversationId();
    if (cavemanNeedsInstruction(conversationId)) {
      return { kind: "instruction", text: CAVEMAN.CAVEMAN_INSTRUCTION };
    }
    if ((responsesSinceInjection.get(conversationId) || 0) >= CAVEMAN.CAVEMAN_REMINDER_EVERY_N_RESPONSES) {
      return { kind: "reminder", text: CAVEMAN.CAVEMAN_REMINDER };
    }
    return null;
  }

  // ---- Trim-preview modal (its own shadow host, independent of the widget) --

  let cavemanModalHost = null;
  let cavemanModalRoot = null;
  let cavemanPreviewOriginal = "";

  async function ensureCavemanModal() {
    if (cavemanModalRoot) return;
    cavemanModalHost = document.createElement("div");
    cavemanModalHost.id = "cuc-caveman-modal";
    const shadow = cavemanModalHost.attachShadow({ mode: "open" });
    const cssText = await widgetCssText;
    try {
      const sheet = new CSSStyleSheet();
      sheet.replaceSync(cssText);
      shadow.adoptedStyleSheets = [sheet];
    } catch {
      const style = document.createElement("style");
      style.textContent = cssText;
      shadow.appendChild(style);
    }
    const wrap = document.createElement("div");
    wrap.className = "cuc-root";
    wrap.innerHTML = `
      <div class="cuc-overlay" data-cuc="overlay" hidden>
        <div class="cuc-modal" role="dialog" aria-modal="true" aria-label="Caveman Mode trimmed prompt">
          <div class="cuc-modal-title">Caveman Mode · trimmed prompt <span class="cuc-modal-savings" data-cuc="modal-savings"></span></div>
          <textarea class="cuc-modal-text" data-cuc="modal-text" rows="7" aria-label="Trimmed prompt — edit before sending"></textarea>
          <details class="cuc-modal-original">
            <summary>Show original</summary>
            <div class="cuc-modal-original-text" data-cuc="modal-original"></div>
          </details>
          <div class="cuc-modal-note" data-cuc="modal-note" hidden></div>
          <div class="cuc-modal-actions">
            <button class="cuc-btn cuc-btn-primary" data-cuc-action="send-trimmed">Send trimmed</button>
            <button class="cuc-btn" data-cuc-action="send-original">Send original</button>
            <button class="cuc-btn" data-cuc-action="cancel-preview">Cancel</button>
          </div>
        </div>
      </div>
    `;
    shadow.appendChild(wrap);
    cavemanModalRoot = shadow;
    document.body.appendChild(cavemanModalHost);
    syncModalDarkMode();

    wrap.addEventListener("click", event => {
      const action = event.target?.closest?.("[data-cuc-action]")?.getAttribute("data-cuc-action");
      if (action === "send-trimmed") {
        sendFromCavemanPreview(cavemanModalRoot.querySelector("[data-cuc='modal-text']").value);
      } else if (action === "send-original") {
        sendFromCavemanPreview(cavemanPreviewOriginal);
      } else if (action === "cancel-preview" || event.target?.getAttribute?.("data-cuc") === "overlay") {
        closeCavemanPreview();
      }
    });
    wrap.addEventListener("keydown", event => {
      if (event.key === "Escape") closeCavemanPreview();
    });
  }

  function syncModalDarkMode() {
    cavemanModalHost?.classList.toggle("cuc-dark", pageIsDarkMode());
  }

  async function openCavemanPreview(originalText) {
    await ensureCavemanModal();
    syncModalDarkMode();
    cavemanPreviewOriginal = originalText;
    const compressed = CAVEMAN.compressPrompt(originalText);
    cavemanModalRoot.querySelector("[data-cuc='modal-text']").value = compressed.text;
    cavemanModalRoot.querySelector("[data-cuc='modal-savings']").textContent = compressed.changed
      ? `· ${compressed.savedPct}% shorter`
      : "· nothing to trim";
    cavemanModalRoot.querySelector("[data-cuc='modal-original']").textContent = originalText;
    const note = cavemanModalRoot.querySelector("[data-cuc='modal-note']");
    const prefix = cavemanPrefixForNextSend();
    if (prefix) {
      note.textContent = prefix.kind === "instruction"
        ? "The Caveman Mode instruction will be added to the top of this message (one time for this chat)."
        : "A one-line brevity reminder will be added (this chat is getting long).";
      note.hidden = false;
    } else {
      note.hidden = true;
    }
    cavemanModalRoot.querySelector("[data-cuc='overlay']").hidden = false;
    cavemanModalOpen = true;
    cavemanModalRoot.querySelector("[data-cuc='modal-text']").focus();
  }

  function closeCavemanPreview() {
    if (cavemanModalRoot) cavemanModalRoot.querySelector("[data-cuc='overlay']").hidden = true;
    cavemanModalOpen = false;
  }

  async function sendFromCavemanPreview(body) {
    const text = String(body || "").trim();
    if (!text) {
      closeCavemanPreview();
      return;
    }
    const conversationId = CUC.currentConversationId();
    const prefix = cavemanPrefixForNextSend();
    closeCavemanPreview();
    const finalText = prefix ? `${prefix.text}\n\n${text}` : text;
    if (prefix) {
      responsesSinceInjection.set(conversationId, 0);
      if (prefix.kind === "instruction") {
        if (conversationId === "home-or-new-chat") {
          // Real conversation id doesn't exist yet — mark it once the URL
          // settles on /chat/<id> (see observeSpaNavigation).
          cavemanPendingMark = true;
        } else {
          cavemanInjectedMap[conversationId] = Date.now();
          claimCavemanInjection(conversationId); // fire-and-forget persist
        }
      }
    }
    const sent = await sendComposerMessage(finalText);
    if (!sent && prefix?.kind === "instruction" && conversationId !== "home-or-new-chat") {
      unclaimCavemanInjection(conversationId);
    }
  }

  // Send interception: only active while Caveman Mode is on. Captures at the
  // document level (capture phase runs before the page's own handlers),
  // opens the preview, and lets the user decide. Nothing is ever auto-sent.
  function interceptSendIfNeeded(event) {
    if (settings.showCavemanMode === false || !settings.cavemanMode || !CAVEMAN || cavemanModalOpen) return;
    if (skipNextSendIntercept) {
      skipNextSendIntercept = false;
      return;
    }
    const text = getComposerText();
    if (!text) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    openCavemanPreview(text);
  }

  function observeCavemanSends() {
    // Listen on window in the capture phase — the earliest point in event
    // dispatch, so we run before claude.ai's own Enter/submit handlers
    // (ProseMirror keymap, React root) and can block the send to show the
    // preview. document-level capture worked in most cases, but window is
    // strictly earlier and avoids losing the race to a page window-listener.
    window.addEventListener("keydown", event => {
      // Enter that confirms an IME composition is not a send.
      if (event.isComposing || event.keyCode === 229) return;
      const isEnterSend = event.key === "Enter" && !event.shiftKey && !event.metaKey && !event.ctrlKey && !event.altKey;
      if (!isEnterSend) return;
      // Accept focus OR the event target being inside the composer — some
      // editors momentarily move focus during key handling.
      if (!isInsideComposer(document.activeElement) && !isInsideComposer(event.target)) return;
      interceptSendIfNeeded(event);
    }, true);

    window.addEventListener("click", event => {
      const button = event.target?.closest?.("button, [role='button']");
      if (!button) return;
      const label = `${button.getAttribute("aria-label") || ""} ${button.textContent || ""}`.toLowerCase();
      // Icon-only send buttons expose their purpose via aria-label ("Send
      // message"); match that or a submit button sitting in the composer.
      const looksLikeSend = /\bsend\b/.test(label) || button.matches("button[type='submit']");
      if (!looksLikeSend) return;
      const anchor = findComposerAnchor();
      const nearComposer = Boolean(button.closest("form, [data-testid*='composer'], [data-testid*='chat-input']"))
        || Boolean(anchor && (anchor.contains(button) || anchor.parentElement?.contains(button)));
      if (!nearComposer) return;
      interceptSendIfNeeded(event);
    }, true);
  }

  // ---- File → Markdown drop zone --------------------------------------------

  const DROPZONE_DEFAULT_LABEL = "Click to pick a file → Markdown (fewer tokens than raw files)";
  // Accepted dropzone extensions. Three lists gate an extension end to end:
  // this one, background.js's CONVERTIBLE_EXTENSIONS (minus md/txt, which
  // never leave this file), and the parser fileType mapping in sandbox.js's
  // convert() — an extension the parser only knows under another name (htm →
  // html today) must be aliased THERE, or it passes both gates then fails.
  const CONVERTIBLE_EXTENSIONS = new Set(["pdf", "docx", "pptx", "xlsx", "odt", "odp", "ods", "rtf", "csv", "html", "htm", "md", "txt"]);
  // Cap for the txt/md fast path — mirrors MAX_MARKDOWN_CHARS in sandbox.js.
  const MAX_TEXT_MARKDOWN_CHARS = 800_000;
  let dropzoneResetTimer = null;

  function setDropzoneLabel(text, revert = false) {
    const label = widgetRoot?.querySelector("[data-cuc='dropzone-label']");
    if (!label) return;
    label.textContent = text;
    clearTimeout(dropzoneResetTimer);
    if (revert) {
      dropzoneResetTimer = setTimeout(() => {
        const el = widgetRoot?.querySelector("[data-cuc='dropzone-label']");
        if (el) el.textContent = DROPZONE_DEFAULT_LABEL;
      }, 12000);
    }
  }

  async function convertDroppedFile(file) {
    const ext = (file.name.split(".").pop() || "").toLowerCase();
    if (!CONVERTIBLE_EXTENSIONS.has(ext)) {
      setDropzoneLabel(`Can't convert .${ext} — supported: pdf, docx, pptx, xlsx, csv, html, txt…`, true);
      return;
    }
    if (file.size > 20 * 1024 * 1024) {
      setDropzoneLabel("File too large (max 20 MB).", true);
      return;
    }
    try {
      let markdown;
      if (ext === "txt" || ext === "md") {
        setDropzoneLabel(`Converting ${file.name}…`);
        markdown = await file.text();
        // Same output cap as the sandbox parser path (sandbox.js's
        // MAX_MARKDOWN_CHARS) — without it a 20MB text file would be pasted
        // whole into the composer, the opposite of what this zone promises.
        if (markdown.length > MAX_TEXT_MARKDOWN_CHARS) {
          markdown = `${markdown.slice(0, MAX_TEXT_MARKDOWN_CHARS)}\n\n… [truncated: file exceeds ${Math.round(MAX_TEXT_MARKDOWN_CHARS / 1000)}k characters]`;
        }
      } else {
        setDropzoneLabel(`Converting ${file.name}…`);
        const dataUrl = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result);
          reader.onerror = () => reject(reader.error || new Error("read failed"));
          reader.readAsDataURL(file);
        });
        const response = await chrome.runtime.sendMessage({ type: "cuc:convert-file", dataUrl, ext });
        if (!response?.ok || !String(response.markdown || "").trim()) {
          throw new Error(response?.error || "no text found");
        }
        markdown = response.markdown;
      }
      const text = `Converted from ${file.name}:\n\n${String(markdown).trim()}`;
      const approxTokens = CUC.formatTokens(Math.round(text.length / 3.8));
      // Prefer dropping the Markdown straight into the chat box — that's the
      // most direct outcome. Clipboard is the fallback (and can fail anyway
      // if the conversion outran the click's transient activation).
      if (setComposerText(text)) {
        setDropzoneLabel(`✓ ${file.name} → Markdown added to the chat box (≈${approxTokens} tokens).`, true);
        return;
      }
      try {
        await navigator.clipboard.writeText(text);
        setDropzoneLabel(`✓ ${file.name} → Markdown copied (≈${approxTokens} tokens). Paste it with Ctrl+V.`, true);
      } catch {
        setDropzoneLabel("Converted, but couldn't reach the chat box or clipboard — try again.", true);
      }
    } catch (error) {
      setDropzoneLabel(`Couldn't convert ${file.name}: ${String(error?.message || error).slice(0, 120)}`, true);
    }
  }

  // Primary interaction is CLICK-to-pick: claude.ai shows a full-viewport
  // drag-and-drop overlay the moment a file is dragged over the page, so a
  // real drop never reaches this zone. A file picker sidesteps that overlay
  // entirely. Drag-and-drop is kept as a best-effort bonus for the rare case
  // the drop does land here.
  function wireDropzone(container) {
    const dropzone = container.querySelector("[data-cuc='dropzone']");
    const input = container.querySelector("[data-cuc='dropzone-input']");
    if (!dropzone || !input) return;

    const openPicker = () => input.click();
    dropzone.addEventListener("click", event => {
      // Don't recurse when the click is the <input> itself bubbling up.
      if (event.target === input) return;
      openPicker();
    });
    dropzone.addEventListener("keydown", event => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        openPicker();
      }
    });
    input.addEventListener("change", () => {
      const file = input.files?.[0];
      // Reset so picking the same file twice still fires change.
      input.value = "";
      if (file) convertDroppedFile(file);
    });

    dropzone.addEventListener("dragover", event => {
      event.preventDefault();
      event.stopPropagation();
      dropzone.classList.add("drag");
    });
    dropzone.addEventListener("dragleave", () => dropzone.classList.remove("drag"));
    dropzone.addEventListener("drop", event => {
      event.preventDefault();
      event.stopPropagation();
      dropzone.classList.remove("drag");
      const file = event.dataTransfer?.files?.[0];
      if (file) convertDroppedFile(file);
    });
  }

  // Guard against docking to something enormous — a real composer wrapper is
  // a small strip near the bottom of the viewport, not most of the page. Used
  // by the fallback below to reject document.body/main scroll containers.
  function isSaneAnchorCandidate(el) {
    if (!el || el === document.body || el === document.documentElement) return false;
    const rect = el.getBoundingClientRect?.();
    if (!rect || rect.height <= 0) return false;
    return rect.height <= window.innerHeight * 0.4;
  }

  // Last resort when none of the known testid/form selectors match (claude.ai
  // markup changed underneath us). Find the live ProseMirror composer
  // directly via [contenteditable="true"] and walk up looking for a stable
  // wrapper: one that also contains a send-like button, or sits directly
  // inside a fixed/sticky-positioned container (the usual composer dock).
  function findComposerAnchorFallback() {
    const editable = document.querySelector("[contenteditable='true']");
    if (!editable) return null;

    let node = editable;
    for (let depth = 0; depth < 6 && node; depth += 1) {
      const hasSendButton = Boolean(node.querySelector?.("button[aria-label*='send' i], button[type='submit']"));
      const parentStyle = node.parentElement ? getComputedStyle(node.parentElement) : null;
      const parentIsDockedContainer = parentStyle && (parentStyle.position === "fixed" || parentStyle.position === "sticky");
      if ((hasSendButton || parentIsDockedContainer) && isSaneAnchorCandidate(node)) {
        return node;
      }
      node = node.parentElement;
    }
    return isSaneAnchorCandidate(editable) ? editable : null;
  }

  function findComposerAnchor() {
    for (const selector of COMPOSER_ANCHOR_SELECTORS) {
      try {
        const anchor = document.querySelector(selector);
        if (anchor) return anchor;
      } catch {
        // Ignore unsupported selector variants and try the next one.
      }
    }
    return findComposerAnchorFallback();
  }

  // The anchor selectors match the composer's inner input area, but the box
  // the user SEES — the rounded, bordered container around the text field —
  // is usually a few ancestors above it. Docking after the inner anchor put
  // the widget INSIDE that box. Walk upward and keep the outermost ancestor
  // that still looks like the visual chat box (rounded corners plus a border,
  // background, or shadow), so the widget lands BELOW the box instead.
  function findVisualComposerBox(anchor) {
    let best = null;
    let node = anchor;
    for (let depth = 0; depth < 8 && node && node !== document.body && node !== document.documentElement; depth += 1) {
      let style;
      try {
        style = getComputedStyle(node);
      } catch {
        break;
      }
      const rounded = parseFloat(style.borderTopLeftRadius) >= 8;
      const bordered = style.borderTopStyle !== "none" && parseFloat(style.borderTopWidth) > 0;
      const bg = style.backgroundColor;
      const surfaced = (style.boxShadow && style.boxShadow !== "none")
        || (bg && bg !== "transparent" && bg !== "rgba(0, 0, 0, 0)");
      if (rounded && (bordered || surfaced) && isSaneAnchorCandidate(node)) best = node;
      node = node.parentElement;
    }
    return best;
  }

  function resolveDockTarget() {
    const anchor = findComposerAnchor();
    if (!anchor) return null;
    return findVisualComposerBox(anchor)
      || anchor.closest?.("form, [data-testid*='composer']")
      || anchor;
  }

  // Keep the widget exactly as wide as the chat box it docks under, tracking
  // window resizes and claude.ai layout changes via ResizeObserver.
  let widthSyncObserver = null;
  let widthSyncTarget = null;

  function syncWidgetWidthTo(target) {
    if (!widget || !target) return;
    const apply = () => {
      if (!widget) return;
      const rect = target.getBoundingClientRect();
      if (rect.width > 0) widget.style.width = `${rect.width}px`;
    };
    if (widthSyncTarget !== target) {
      widthSyncObserver?.disconnect();
      widthSyncObserver = new ResizeObserver(apply);
      widthSyncObserver.observe(target);
      widthSyncTarget = target;
    }
    apply();
  }

  function placeWidget() {
    if (!widget) return;

    const dockTarget = resolveDockTarget();
    if (!dockTarget || !dockTarget.parentElement) {
      widget.remove();
      return;
    }

    widget.classList.add("cuc-docked");
    try {
      dockTarget.parentElement.insertBefore(widget, dockTarget.nextSibling);
    } catch {
      // The parent is React-managed and can be mid-reconciliation; the dock
      // observer will retry on the next mutation batch rather than letting a
      // transient NotFoundError propagate into the page.
    }
    syncWidgetWidthTo(dockTarget);
  }

  const DISPLAY_MODE_GLYPHS = { dollars: "$", tokens: "#", both: "$#" };
  // What clicking the cycle button does FROM the current display mode — used
  // to keep its aria-label describing the actual next action rather than a
  // generic fixed description, so a screen-reader user always knows what the
  // button (and its glyph) currently means.
  const DISPLAY_MODE_NEXT = { dollars: "tokens", tokens: "both", both: "dollars" };
  const DISPLAY_MODE_NAMES = { dollars: "dollars", tokens: "tokens", both: "dollars and tokens" };

  // Today's spend: prefer the per-model breakdown learned from claude.ai's
  // own usage page (fresh within 6h), else the day-chain of counter samples.
  function todaySpendInfo() {
    const todayKey = CUC.todayKey();
    if (spendBreakdown?.fetchedAt && Date.now() - spendBreakdown.fetchedAt < 6 * 60 * 60 * 1000) {
      const rows = (spendBreakdown.rows || []).filter(r => !r.dateKey || r.dateKey === todayKey);
      if (rows.length) {
        const spendUsd = rows.reduce((sum, r) => sum + (Number(r.spendUsd) || 0), 0);
        return { spendUsd, rows, source: "breakdown" };
      }
    }
    const chained = CUC.daySpendUsd(spendDays, todayKey);
    return chained == null ? null : { spendUsd: chained, rows: null, source: "chain" };
  }

  function spendValueText(spendUsd, modelKey, rows = null) {
    const usdText = CUC.formatUsd(spendUsd);
    let rangeText;
    if (rows && rows.length) {
      // Per-model conversion when the breakdown says which models the money
      // went to; the low/high spread still comes from the mix bounds.
      const low = rows.reduce((s, r) => s + CUC.estimateTokensFromSpend(r.spendUsd, r.modelKey || modelKey, CUC.SPEND_TOKEN_MIX_LOW), 0);
      const high = rows.reduce((s, r) => s + CUC.estimateTokensFromSpend(r.spendUsd, r.modelKey || modelKey, CUC.SPEND_TOKEN_MIX_HIGH), 0);
      rangeText = CUC.formatTokenRange({ low, high });
    } else {
      rangeText = CUC.formatTokenRange(CUC.estimateTokenRangeFromSpend(spendUsd, modelKey));
    }
    if (settings.displayMode === "tokens") return rangeText;
    if (settings.displayMode === "both") return `${usdText} · ${rangeText}`;
    return usdText;
  }

  function renderWidget() {
    // widgetRoot stays null until the shadow content (and its stylesheet)
    // is in place — early renders just skip; state changes re-render later.
    if (!widget || !widgetRoot) return;
    widget.classList.toggle("cuc-hidden", !settings.showWidget);

    // Model detection stays live year-round — it feeds the dollars→tokens
    // conversion below even though the widget no longer shows a model footer.
    const modelKey = detectModelKey();

    const cycleButton = widgetRoot.querySelector("[data-cuc-action='cycle']");
    if (cycleButton) {
      cycleButton.textContent = DISPLAY_MODE_GLYPHS[settings.displayMode] || "$";
      const nextMode = DISPLAY_MODE_NEXT[settings.displayMode] || "dollars";
      const label = `Showing ${DISPLAY_MODE_NAMES[settings.displayMode] || "dollars"}. Switch display to ${DISPLAY_MODE_NAMES[nextMode]}.`;
      cycleButton.setAttribute("aria-label", label);
      cycleButton.title = `Switch display to ${DISPLAY_MODE_NAMES[nextMode]}`;
    }

    // "Spent this session" — Claude's own counter, sampled at session start
    // and on every poll/response since. The whole meter block (headline,
    // bar, Today line) is individually hideable.
    const meterEl = widgetRoot.querySelector("[data-cuc='meter']");
    const showSessionSpend = settings.showSessionSpend !== false;
    if (meterEl) meterEl.hidden = !showSessionSpend;
    if (showSessionSpend) {
      const deltaUsd = CUC.sessionSpendDelta(spendSession);
      const sessionValueEl = widgetRoot.querySelector("[data-cuc='session-value']");
      const sessionDetailEl = widgetRoot.querySelector("[data-cuc='session-detail']");
      const sessionBar = widgetRoot.querySelector("[data-cuc='session-bar']");

      if (deltaUsd == null) {
        sessionValueEl.textContent = "—";
        sessionDetailEl.hidden = true;
        setBar(sessionBar, 0);
      } else {
        sessionValueEl.textContent = spendValueText(deltaUsd, modelKey);
        // Bar: how much of the monthly allowance this session consumed.
        // Respect the "hide monthly allowance" preference here too — a user
        // who hid that row shouldn't have its scale leak back in via this
        // bar's fill level and aria text.
        const limitUsd = settings.showMonthlyCredits !== false
          ? nativeUsage?.monthlySpendLimit?.limitUsd
          : null;
        const sessionPct = limitUsd > 0 ? (deltaUsd / limitUsd) * 100 : 0;
        setBar(sessionBar, sessionPct, limitUsd > 0
          ? `${Math.round(CUC.clamp(sessionPct, 0, 100))}% of monthly allowance used this session`
          : null);

        const today = todaySpendInfo();
        if (today && today.spendUsd >= 0.005 && Math.abs(today.spendUsd - deltaUsd) >= 0.005) {
          sessionDetailEl.textContent = `Today: ${spendValueText(today.spendUsd, modelKey, today.rows)}`;
          sessionDetailEl.hidden = false;
        } else {
          sessionDetailEl.hidden = true;
        }

        // "This week:" — same shape as the Today line above, just windowed to
        // Claude's real weekly reset (falls back to a rolling 7 days when the
        // weekly bucket's resetsAt isn't known yet). Individually hideable.
        const weekDetailEl = widgetRoot.querySelector("[data-cuc='week-detail']");
        if (weekDetailEl) {
          const showWeekSpend = settings.showWeekSpend !== false;
          if (showWeekSpend) {
            const sinceMs = nativeUsage?.sevenDay?.resetsAt
              ? Date.parse(nativeUsage.sevenDay.resetsAt) - 7 * 24 * 60 * 60 * 1000
              : null;
            const weekUsd = CUC.weekSpendUsd?.(spendDays, { sinceMs, now: Date.now() });
            if (typeof weekUsd === "number" && weekUsd >= 0.005) {
              weekDetailEl.textContent = `This week: ${spendValueText(weekUsd, modelKey)}`;
              weekDetailEl.hidden = false;
            } else {
              weekDetailEl.hidden = true;
            }
          } else {
            weekDetailEl.hidden = true;
          }
        }
      }
    }

    // Caveman Mode row + switch + drop zone visibility. The whole row hides
    // when the user has turned the feature off in Settings (showCavemanMode).
    const cavemanRow = widgetRoot.querySelector("[data-cuc='caveman-row']");
    const cavemanVisible = settings.showCavemanMode !== false;
    if (cavemanRow) cavemanRow.hidden = !cavemanVisible;
    const cavemanSwitch = widgetRoot.querySelector("[data-cuc-action='caveman-toggle']");
    if (cavemanSwitch) {
      cavemanSwitch.classList.toggle("on", Boolean(settings.cavemanMode));
      cavemanSwitch.setAttribute("aria-checked", String(Boolean(settings.cavemanMode)));
    }
    const dropzone = widgetRoot.querySelector("[data-cuc='dropzone']");
    if (dropzone) dropzone.hidden = !(cavemanVisible && settings.cavemanMode);

    renderNativeLimits();
    renderTip();
  }

  function nativeUsageBarLevel(pct) {
    if (pct >= 90) return "high";
    if (pct >= 70) return "medium";
    return "low";
  }

  // Update a progress bar's fill, color, and the aria-valuenow/aria-valuetext
  // on its role="progressbar" container in one place. valueText, when given,
  // is the human-readable string screen readers announce instead of the bare
  // percentage (e.g. "42% · resets in 2h 15m").
  function setBar(bar, pct, valueText) {
    if (!bar) return;
    const clamped = CUC.clamp(pct, 0, 100);
    bar.style.width = `${clamped}%`;
    bar.className = `cuc-progress-bar ${nativeUsageBarLevel(clamped)}`;
    const container = bar.parentElement;
    container?.setAttribute?.("aria-valuenow", String(Math.round(clamped)));
    if (valueText) container?.setAttribute?.("aria-valuetext", valueText);
    else container?.removeAttribute?.("aria-valuetext");
  }

  // The three rolling-limit buckets Claude itself reports. These are what
  // actually locks a person out mid-workday, so they get first-class rows.
  const NATIVE_BUCKETS = [
    { key: "five-hour", prop: "fiveHour", label: "Session limit", prefKey: "showSessionLimit" },
    { key: "seven-day", prop: "sevenDay", label: "Weekly limit", prefKey: "showWeeklyLimit" },
    { key: "opus", prop: "sevenDayOpus", label: "Weekly Opus limit", prefKey: "showOpusLimit" }
  ];

  function bucketValueText(bucket) {
    const pct = Math.round(CUC.clamp(bucket.utilizationPct, 0, 100));
    const countdown = CUCNative?.formatResetCountdown ? CUCNative.formatResetCountdown(bucket.resetsAt) : null;
    return countdown ? `${pct}% · resets in ${countdown}` : `${pct}%`;
  }

  // Whether ANY of the four rolling/monthly limit rows are visible per the
  // user's per-metric prefs — decides whether the whole native section (and
  // its status note) renders at all. Shared with the popup via shared.js.
  function anyNativeLimitPrefVisible() {
    return CUC.anyNativeLimitPrefVisible(settings);
  }

  // Returns the most urgent plain-English warning across all native buckets,
  // or null when everything is comfortably below the warning threshold. Any
  // bucket the user chose to hide (per-metric pref) is excluded so a warning
  // can't leak a number they don't want shown — this mirrors the existing
  // includeMonthly guard for the monthly-credit bucket.
  function mostUrgentNativeWarning(native, { includeMonthly = settings.showMonthlyCredits !== false } = {}) {
    if (!native) return null;
    const candidates = [];
    for (const { prop, label, prefKey } of NATIVE_BUCKETS) {
      if (settings[prefKey] === false) continue;
      const bucket = native[prop];
      if (bucket && typeof bucket.utilizationPct === "number") {
        candidates.push({ pct: bucket.utilizationPct, label, resetsAt: bucket.resetsAt });
      }
    }
    const spend = native.monthlySpendLimit;
    if (spend && includeMonthly) candidates.push({ pct: spend.utilizationPct, label: "Monthly allowance", resetsAt: null });

    const worst = candidates.filter(c => c.pct >= 80).sort((a, b) => b.pct - a.pct)[0];
    if (!worst) return null;
    const countdown = worst.resetsAt && CUCNative?.formatResetCountdown ? CUCNative.formatResetCountdown(worst.resetsAt) : null;
    if (worst.pct >= 90) {
      return countdown
        ? `${worst.label} almost used up — it resets in ${countdown}.`
        : `${worst.label} almost used up.`;
    }
    return `Heads up: ${worst.label.toLowerCase()} is at ${Math.round(worst.pct)}%.`;
  }

  function renderNativeLimits() {
    const section = widgetRoot.querySelector("[data-cuc='native-section']");
    if (!section) return;

    // All four rows pref-hidden → collapse the whole section (including the
    // status note) rather than leaving an empty, bordered husk behind.
    if (!anyNativeLimitPrefVisible()) {
      section.style.display = "none";
      return;
    }
    section.style.display = "block";

    const note = widgetRoot.querySelector("[data-cuc='enterprise-note']");
    // The note line only renders when it says something actionable (loading,
    // errors, warnings) — the old always-on "Live limits from Claude.ai — not
    // an estimate." caption is covered by each row's hover tooltip now.
    const setNote = (text) => {
      note.textContent = text || "";
      note.hidden = !text;
    };
    const rows = {};
    for (const { key } of NATIVE_BUCKETS) {
      rows[key] = widgetRoot.querySelector(`[data-cuc='row-${key}']`);
    }
    const enterpriseRow = widgetRoot.querySelector("[data-cuc='row-enterprise']");
    const enterpriseValue = widgetRoot.querySelector("[data-cuc='enterprise-value']");
    const enterpriseBar = widgetRoot.querySelector("[data-cuc='enterprise-bar']");

    const hideAllRows = () => {
      for (const { key } of NATIVE_BUCKETS) rows[key] && (rows[key].hidden = true);
      if (enterpriseRow) enterpriseRow.hidden = true;
    };

    if (nativeUsageError === "not-logged-in") {
      hideAllRows();
      setNote("Sign in to claude.ai to see your real limits.");
      return;
    }
    if (nativeUsageError === "forbidden") {
      hideAllRows();
      setNote("The configured Organization ID doesn't match this account — check Settings, or clear it to auto-detect.");
      return;
    }
    if (nativeUsageError === "rate-limited") {
      hideAllRows();
      setNote("Claude is rate-limiting usage lookups; retrying with backoff.");
      return;
    }
    if (nativeUsageError) {
      hideAllRows();
      setNote("Claude's limit data is unavailable right now.");
      return;
    }
    if (!nativeUsage) {
      hideAllRows();
      setNote("Loading Claude usage…");
      return;
    }

    // Rolling limits (session/weekly/Opus) — Claude's own numbers. Each row
    // is gated on its own pref FIRST: pref-off hides the row even when
    // Claude's data says there's something to show (e.g. Opus usage > 0).
    for (const { key, prop, prefKey } of NATIVE_BUCKETS) {
      const row = rows[key];
      if (!row) continue;
      if (settings[prefKey] === false) {
        row.hidden = true;
        continue;
      }
      const bucket = nativeUsage[prop];
      if (!bucket || typeof bucket.utilizationPct !== "number") {
        row.hidden = true;
        continue;
      }
      // The Opus row only matters for people who actually use Opus — hide it
      // at zero to keep the widget calm for everyone else.
      if (key === "opus" && bucket.utilizationPct <= 0) {
        row.hidden = true;
        continue;
      }
      row.hidden = false;
      const valueText = bucketValueText(bucket);
      widgetRoot.querySelector(`[data-cuc='${key}-value']`).textContent = valueText;
      setBar(widgetRoot.querySelector(`[data-cuc='${key}-bar']`), bucket.utilizationPct, valueText);
    }

    // Monthly usage-credit allowance — individually hideable (personal-plan
    // users may not want a monthly-credit view). When hidden, the row is
    // suppressed and the monthly bucket is excluded from the warning line too.
    const spendLimit = nativeUsage.monthlySpendLimit;
    const showMonthly = settings.showMonthlyCredits !== false;
    if (!showMonthly || !spendLimit) {
      if (enterpriseRow) enterpriseRow.hidden = true;
      setNote(mostUrgentNativeWarning(nativeUsage));
      return;
    }
    if (enterpriseRow) enterpriseRow.hidden = false;
    const pct = CUC.clamp(spendLimit.utilizationPct, 0, 100);
    const resetLabel = CUCNative?.formatResetLabel ? CUCNative.formatResetLabel(spendLimit) : null;
    const enterpriseText = resetLabel
      ? `${CUC.formatUsd(spendLimit.usedUsd)} of ${CUC.formatUsd(spendLimit.limitUsd)} · ${resetLabel}`
      : `${CUC.formatUsd(spendLimit.usedUsd)} of ${CUC.formatUsd(spendLimit.limitUsd)}`;
    enterpriseValue.textContent = enterpriseText;
    setBar(enterpriseBar, pct, enterpriseText);

    if (spendLimit.outOfCredits) {
      setNote("Monthly usage-credit limit reached");
    } else {
      setNote(mostUrgentNativeWarning(nativeUsage));
    }
  }

  // One plain-English coaching line, shown only when it's actionable.
  // Priority: pace projection (forward-looking, most decision-relevant) >
  // suppress if the native note already carries a warning.
  function renderTip() {
    const tip = widgetRoot.querySelector("[data-cuc='tip']");
    if (!tip) return;
    // The pace projection is specifically about the 5-hour session limit, so
    // it follows that row's own visibility pref rather than the section as a
    // whole.
    if (!settings.showPlainEnglishTips || settings.showSessionLimit === false) {
      tip.hidden = true;
      return;
    }
    const projection = CUC.projectDepletion(paceSamples, Date.now(), nativeUsage?.fiveHour?.resetsAt || null);
    const paceText = CUC.paceWarningText(projection);
    if (paceText && !mostUrgentNativeWarning(nativeUsage)) {
      tip.textContent = paceText;
      tip.hidden = false;
      return;
    }
    tip.hidden = true;
  }

  function observeNetworkEvents() {
    window.addEventListener("cuc:network-event", event => {
      const detail = event.detail || {};
      // Drop events that don't carry the handshake token minted at startup —
      // anything else is a forgery from some other page-world script.
      if (detail.token !== NETWORK_EVENT_TOKEN) return;

      if (detail.kind === "model-detected" && detail.modelId) {
        const detected = CUC.detectModelFromId(detail.modelId) || CUC.detectModelFromText(detail.modelId);
        if (detected) {
          setNetworkModelForConversation(detail.conversationId, detected);
          renderWidget();
        }
      }

      if (detail.kind === "generation-complete") {
        // Count responses per conversation for the Caveman reminder cadence.
        const convoKey = detail.conversationId || CUC.currentConversationId();
        responsesSinceInjection.set(convoKey, (responsesSinceInjection.get(convoKey) || 0) + 1);

        // A response just finished — Claude's counter updates shortly after.
        // Force a live re-read (bypassing the shared cross-tab cache) so the
        // session number moves right after each exchange, which is the whole
        // point of the delta design.
        clearTimeout(generationRefreshTimer);
        generationRefreshTimer = setTimeout(() => {
          refreshNativeUsage({ force: true });
        }, 2500);
      }
    });

    window.addEventListener("cuc:usage-snapshot", event => {
      const detail = event.detail || {};
      if (detail.token !== NETWORK_EVENT_TOKEN) return;

      // claude.ai's own Settings → Usage page just called a spend-report
      // endpoint we don't know about — remember the path so the breakdown
      // fetcher can learn it (no payload crosses the bus, only the path).
      if (detail.kind === "spend-report-endpoint" && typeof detail.path === "string") {
        CUCNative?.rememberSpendEndpoint?.(detail.path).then(learned => {
          if (learned) refreshSpendBreakdown(true);
        }).catch(() => {});
      }

      // Generation streams push live message_limit frames with the same
      // utilization data the /usage endpoint reports — fresher than our poll.
      // Merge the sanitized buckets straight into the current reading for an
      // instant display update (display-only; the polled endpoint remains the
      // authoritative cross-tab source).
      const buckets = detail.buckets;
      if (buckets && nativeUsage) {
        let merged = false;
        for (const prop of ["fiveHour", "sevenDay", "sevenDayOpus"]) {
          const fresh = buckets[prop];
          if (!fresh || typeof fresh.utilizationPct !== "number") continue;
          nativeUsage[prop] = {
            ...(nativeUsage[prop] || {}),
            utilizationPct: fresh.utilizationPct,
            resetsAt: fresh.resetsAt || nativeUsage[prop]?.resetsAt || null
          };
          merged = true;
        }
        if (merged) {
          renderWidget();
          updateToolbarBadge();
        }
      }

      // claude.ai just fetched its own usage data, so ours may be stale —
      // refresh opportunistically (throttled). We never read the raw payload;
      // the content script re-reads via its own credentialed fetch.
      const now = Date.now();
      if (now - lastUsageSnapshotRefreshAt < 15000) return;
      lastUsageSnapshotRefreshAt = now;
      refreshNativeUsage();
    });
  }

  // Per-model daily breakdown (claude.ai's Settings → Usage data), fetched
  // via the endpoint learned above. Throttled; results shared cross-tab.
  let lastBreakdownAttemptAt = 0;
  async function refreshSpendBreakdown(force = false) {
    if (!CUCNative?.fetchSpendBreakdown) return;
    const now = Date.now();
    if (!force && now - lastBreakdownAttemptAt < 30 * 60 * 1000) return;
    lastBreakdownAttemptAt = now;
    try {
      const result = await CUCNative.fetchSpendBreakdown(nativeUsage);
      if (result) {
        spendBreakdown = result;
        await CUC.ephemeralSet({ "cuc:spend-breakdown": result });
        renderWidget();
      }
    } catch {
      // No learned endpoint yet, or it didn't validate — the day-chain
      // fallback keeps the Today line working.
    }
  }

  function observeSpaNavigation() {
    // Claude.ai is a client-rendered SPA — switching conversations doesn't
    // reload the page, so location.pathname changes without any of the
    // browser's native navigation events firing reliably. Patch history
    // methods and poll as a fallback so the widget's model readout and
    // placement stay in sync with the active chat.
    let lastPath = location.pathname;
    const onPathChange = () => {
      if (location.pathname === lastPath) return;
      lastPath = location.pathname;
      const conversationId = CUC.currentConversationId();
      if (conversationId !== "home-or-new-chat") {
        // A new chat's first message carried the Caveman instruction; now
        // that the real conversation id exists, persist the injected mark.
        if (cavemanPendingMark) {
          cavemanPendingMark = false;
          cavemanInjectedMap[conversationId] = Date.now();
          responsesSinceInjection.set(conversationId, 0);
          claimCavemanInjection(conversationId);
        } else if (settings.cavemanMode) {
          // Switched into a chat that hasn't been instructed yet.
          maybeInjectCavemanInstruction();
        }
      }
      placeWidget();
      renderWidget();
    };

    const originalPushState = history.pushState;
    history.pushState = function patchedPushState(...args) {
      const result = originalPushState.apply(this, args);
      onPathChange();
      return result;
    };
    const originalReplaceState = history.replaceState;
    history.replaceState = function patchedReplaceState(...args) {
      const result = originalReplaceState.apply(this, args);
      onPathChange();
      return result;
    };
    window.addEventListener("popstate", onPathChange);
    // Fallback poll for history mutations the patched push/replaceState miss.
    setInterval(() => { if (!document.hidden) onPathChange(); }, 2000);

    // React re-renders can replace the composer DOM node even without a
    // path change (e.g. attaching a file, switching models). If that
    // detaches our docked widget from the page, re-insert it. Driven by a
    // throttled MutationObserver instead of a fixed 2s poll, so a quiet page
    // costs nothing and a re-render storm is still handled within ~1s.
    let dockCheckTimer = null;
    const checkDock = () => {
      if (document.hidden || !widget) return;
      const dockTarget = resolveDockTarget();
      const isDockedAfterAnchor = dockTarget?.parentElement && widget.parentElement === dockTarget.parentElement && widget.previousElementSibling === dockTarget;
      if (!document.body.contains(widget) || !isDockedAfterAnchor) placeWidget();
    };
    const dockObserver = new MutationObserver(mutations => {
      if (dockCheckTimer || document.hidden || !widget) return;
      // Our own re-insert triggers mutations too; ignore batches that touch
      // only the widget so placement can't feed back into itself.
      const external = mutations.some(m => !widget.contains(m.target));
      if (!external) return;
      dockCheckTimer = setTimeout(() => {
        dockCheckTimer = null;
        checkDock();
      }, 1000);
    });
    const startDockObserver = () => {
      if (document.body) dockObserver.observe(document.body, { childList: true, subtree: true });
      else requestAnimationFrame(startDockObserver);
    };
    startDockObserver();
    // Catch anything a hidden tab missed the moment it becomes visible again.
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") checkDock();
    });
  }

  function bootWhenReady() {
    if (document.body) {
      createWidget();
      return;
    }
    requestAnimationFrame(bootWhenReady);
  }

  // If another tab fetched Claude's usage this recently, reuse its stored
  // result instead of issuing a duplicate request. Cuts N open claude.ai tabs
  // from N usage GETs per minute down to ~1, which also lowers the whole
  // org's 429 exposure.
  const NATIVE_USAGE_SHARED_FRESH_MS = 45 * 1000;

  // Badge/notification feeds respect the same per-metric prefs as the rows:
  // a metric the user hid must not resurface through the toolbar badge or an
  // OS notification — those are MORE intrusive channels, not exempt ones.
  function maxNativeUtilizationPct(native) {
    if (!native) return null;
    const values = [];
    for (const { prop, prefKey } of NATIVE_BUCKETS) {
      if (settings[prefKey] === false) continue;
      const bucket = native[prop];
      if (bucket && typeof bucket.utilizationPct === "number") values.push(bucket.utilizationPct);
    }
    if (settings.showMonthlyCredits !== false
      && typeof native.monthlySpendLimit?.utilizationPct === "number") {
      values.push(native.monthlySpendLimit.utilizationPct);
    }
    return values.length ? Math.max(...values) : null;
  }

  // Flatten the current native reading into per-bucket rows the background
  // can use for the toolbar badge and threshold notifications, plus the
  // monthly counter reading that drives the session/daily spend baselines.
  // Percentages, reset timestamps, and two dollar figures — no account
  // payload crosses this message.
  function nativeUsageBucketsForBackground() {
    if (!nativeUsage) return [];
    const rows = [];
    const push = (key, label, bucket, prefKey) => {
      if (settings[prefKey] === false) return; // hidden metric → no desktop alert either
      if (bucket && typeof bucket.utilizationPct === "number") {
        rows.push({ key, label, pct: bucket.utilizationPct, resetsAt: bucket.resetsAt || null });
      }
    };
    push("five-hour", "Session limit", nativeUsage.fiveHour, "showSessionLimit");
    push("seven-day", "Weekly limit", nativeUsage.sevenDay, "showWeeklyLimit");
    push("opus", "Weekly Opus limit", nativeUsage.sevenDayOpus, "showOpusLimit");
    push("monthly", "Monthly allowance", nativeUsage.monthlySpendLimit, "showMonthlyCredits");
    return rows;
  }

  function updateToolbarBadge() {
    try {
      const spendLimit = nativeUsage?.monthlySpendLimit;
      chrome.runtime.sendMessage({
        type: "cuc:native-usage-updated",
        maxUtilizationPct: maxNativeUtilizationPct(nativeUsage),
        buckets: nativeUsageBucketsForBackground(),
        monthlySpend: spendLimit && typeof spendLimit.usedUsd === "number"
          ? { usedUsd: spendLimit.usedUsd, limitUsd: spendLimit.limitUsd }
          : null
      }).catch(() => {});
    } catch {
      // Badge/notifications/spend samples are routed best-effort; never let
      // them break the refresh loop.
    }
  }

  async function refreshNativeUsage({ force = false } = {}) {
    // No point polling Claude's usage endpoint at all when every limit row
    // that data would feed is pref-hidden.
    if (!anyNativeLimitPrefVisible() || !CUCNative) {
      scheduleNextNativeUsagePoll();
      return;
    }

    // Multi-tab dedupe: another tab may have polled seconds ago and stored
    // the result. Freshness rides on fetchedAt, which fetchNativeUsage stamps.
    // A forced refresh (right after a generation finished) skips the shared
    // cache — its whole purpose is to catch the counter moving JUST now.
    if (!force) {
      try {
        const stored = await CUC.ephemeralGet(["cuc:native-usage", "cuc:pace-samples"]);
        const shared = stored["cuc:native-usage"];
        if (shared?.fetchedAt && Date.now() - shared.fetchedAt < NATIVE_USAGE_SHARED_FRESH_MS) {
          nativeUsage = shared;
          nativeUsageError = null;
          // Another tab is the sampler; just read its samples for display.
          if (Array.isArray(stored["cuc:pace-samples"])) paceSamples = stored["cuc:pace-samples"];
          renderWidget();
          updateToolbarBadge();
          scheduleNextNativeUsagePoll();
          return;
        }
      } catch {
        // Storage hiccup — fall through to a live fetch.
      }
    }

    try {
      nativeUsage = await CUCNative.fetchNativeUsage();
      nativeUsageError = null;
      // A successful fetch clears any backoff accumulated from prior 429s.
      nativeUsageBackoffMs = null;
    } catch (error) {
      nativeUsage = null;
      nativeUsageError = String(error?.message || error);
      if (nativeUsageError === "rate-limited") {
        // Exponential backoff starting at 2x the base interval, capped at 10
        // minutes, reset on the next successful fetch.
        nativeUsageBackoffMs = nativeUsageBackoffMs
          ? Math.min(nativeUsageBackoffMs * 2, NATIVE_USAGE_MAX_BACKOFF_MS)
          : NATIVE_USAGE_REFRESH_MS * 2;
      } else {
        nativeUsageBackoffMs = null;
      }
    }
    // This tab did the live fetch, so it's the one that appends the pace
    // sample (shared-cache readers don't, keeping one sample per poll).
    if (nativeUsage?.fiveHour && typeof nativeUsage.fiveHour.utilizationPct === "number") {
      try {
        const stored = await CUC.ephemeralGet(["cuc:pace-samples"]);
        paceSamples = CUC.appendPaceSample(stored["cuc:pace-samples"], {
          at: nativeUsage.fetchedAt || Date.now(),
          pct: nativeUsage.fiveHour.utilizationPct
        });
        await CUC.ephemeralSet({ "cuc:pace-samples": paceSamples });
      } catch {
        // Sampling is best-effort; the bars themselves don't depend on it.
      }
    }
    await CUC.ephemeralSet({
      "cuc:native-usage": nativeUsage,
      "cuc:native-usage-error": nativeUsageError
    });
    renderWidget();
    updateToolbarBadge();
    refreshSpendBreakdown();
    scheduleNextNativeUsagePoll();
  }

  function scheduleNextNativeUsagePoll() {
    clearTimeout(nativeUsageTimer);
    const delay = nativeUsageBackoffMs ? jitterMs(nativeUsageBackoffMs) : jitteredNativeUsageInterval();
    nativeUsageTimer = setTimeout(() => {
      // Don't poll the usage endpoint while the tab is backgrounded; the
      // visibilitychange handler below refreshes immediately on return. If
      // still hidden when this timer fires, just reschedule rather than
      // spending a poll attempt.
      if (!document.hidden) refreshNativeUsage();
      else scheduleNextNativeUsagePoll();
    }, delay);
  }

  function observeNativeUsageRefresh() {
    refreshNativeUsage();
    document.addEventListener("visibilitychange", () => {
      // Skip the immediate refresh while backing off from a 429 — a tab
      // switch shouldn't undo the backoff we just applied.
      if (document.visibilityState === "visible" && !nativeUsageBackoffMs) refreshNativeUsage();
    });
  }

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "session") {
      if (changes["cuc:spend-session"]) {
        spendSession = changes["cuc:spend-session"].newValue || null;
        renderWidget();
      }
      if (changes["cuc:spend-breakdown"]) {
        spendBreakdown = changes["cuc:spend-breakdown"].newValue || null;
        renderWidget();
      }
      return;
    }
    if (area !== "local") return;
    if (changes["cuc:settings"]?.newValue) {
      settings = CUC.mergeSettings(changes["cuc:settings"].newValue);
      placeWidget();
      renderWidget();
    }
    if (changes["cuc:spend-days"]) {
      spendDays = changes["cuc:spend-days"].newValue || null;
      renderWidget();
    }
    // Session-storage fallback writes land in "local" when storage.session
    // isn't reachable yet — cover them here too.
    if (changes["cuc:spend-session"]) {
      spendSession = changes["cuc:spend-session"].newValue || null;
      renderWidget();
    }
    if (changes["cuc:caveman-injected"]) {
      cavemanInjectedMap = changes["cuc:caveman-injected"].newValue || {};
    }
  });

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === "cuc:show-widget") {
      settings.showWidget = true;
      chrome.storage.local.set({ "cuc:settings": settings }).then(() => sendResponse({ ok: true }));
      return true;
    }
    if (message?.type === "cuc:refresh-native-usage") {
      refreshNativeUsage({ force: true }).then(() => sendResponse({ ok: true, nativeUsage, nativeUsageError }));
      return true;
    }
    return false;
  });

  // Hand the MAIN-world network watcher its auth token immediately — before
  // the async settings load — so a generation kicked off on page load isn't
  // missed while storage resolves.
  startNetworkTokenHandshake();
  observeNetworkEvents();

  loadState().then(() => {
    observeSpaNavigation();
    observeNativeUsageRefresh();
    observeCavemanSends();
    bootWhenReady();
  });
})();
