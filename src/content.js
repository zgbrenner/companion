(() => {
  const CUC = globalThis.ClaudeUsageCompanion;
  const CUCNative = globalThis.ClaudeUsageCompanionNative;
  const STORAGE_KEY = CUC.makeStorageKey();
  let settings = { ...CUC.DEFAULT_SETTINGS };
  let usage = CUC.emptyUsage();
  let widget = null;
  let lastPromptHash = "";
  let lastPromptAt = 0;
  let outputBuffer = "";
  let outputFlushTimer = null;
  let saveTimer = null;
  let nativeUsage = null;
  let nativeUsageError = null;
  let nativeUsageTimer = null;
  let lastTokenEstimateMethod = "heuristic";
  const NATIVE_USAGE_REFRESH_MS = 60 * 1000;

  function injectNetworkWatcher() {
    const script = document.createElement("script");
    script.src = chrome.runtime.getURL("src/injected.js");
    script.onload = () => script.remove();
    (document.documentElement || document.head || document.body).appendChild(script);
  }

  function hashString(value) {
    let hash = 0;
    const s = String(value || "");
    for (let i = 0; i < s.length; i += 1) {
      hash = ((hash << 5) - hash + s.charCodeAt(i)) | 0;
    }
    return String(hash);
  }

  async function loadState() {
    const stored = await chrome.storage.local.get([STORAGE_KEY, "cuc:settings"]);
    settings = { ...CUC.DEFAULT_SETTINGS, ...(stored["cuc:settings"] || {}) };
    usage = stored[STORAGE_KEY] || CUC.emptyUsage();
    if (CUC.shouldResetSession(usage, settings)) {
      usage = CUC.resetSession(usage, "five-hour-window");
      await saveState();
    }
  }

  function saveStateSoon() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveState, 250);
  }

  async function saveState() {
    usage.lastUpdatedAt = Date.now();
    await chrome.storage.local.set({ [STORAGE_KEY]: usage });
    renderWidget();
  }

  function detectModelKey() {
    // Prefer a scoped model-picker control if we can find one — scanning the
    // whole page for words like "opus" or "haiku" produces false positives
    // when those words appear in chat history rather than an active selector.
    // '[data-testid="model-selector-dropdown"]' is a verified selector
    // (confirmed against a live, actively-maintained extension targeting
    // claude.ai); the others are unverified fallbacks in case it changes.
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

  function detectEffortLevel() {
    // Best-effort only: Claude.ai's effort/thinking-level control markup is
    // not documented for extensions, so this is a heuristic scan of
    // selector-like controls, not a guaranteed read. Returns null (shown as
    // no effort suffix) rather than a guess when nothing matches.
    const selectors = [
      "[data-testid*='effort']",
      "[data-testid*='thinking']",
      "[aria-label*='effort' i]",
      "[aria-label*='thinking' i]"
    ];
    for (const selector of selectors) {
      const el = document.querySelector(selector);
      const text = (el?.innerText || el?.getAttribute?.("aria-label") || "").toLowerCase().trim();
      if (!text) continue;
      if (text.includes("high")) return "High";
      if (text.includes("medium") || text.includes("standard")) return "Medium";
      if (text.includes("low")) return "Low";
    }
    return null;
  }

  function getConversationTitle() {
    const title = document.title?.replace(/\s*\|\s*Claude\s*$/i, "").trim();
    if (title && title.toLowerCase() !== "claude") return title.slice(0, 90);
    const h1 = document.querySelector("h1")?.innerText?.trim();
    return h1?.slice(0, 90) || CUC.currentConversationId();
  }

  function countAttachmentChips() {
    // Scope to the composer area only. Broad selectors like [class*='file' i]
    // match unrelated UI (any class containing "file" as a substring) and
    // wildly overcount — each false positive adds ~3500 phantom tokens.
    // '[data-testid="chat-input-grid-container"]' is a verified composer
    // container selector; the rest are unverified fallbacks.
    const composerScopes = Array.from(document.querySelectorAll(
      "[data-testid='chat-input-grid-container'], [data-testid*='composer'], form, [role='form'], [contenteditable='true']"
    )).map(el => el.closest("[data-testid='chat-input-grid-container'], form, [data-testid*='composer']") || el);
    const scopeRoots = new Set(composerScopes.filter(Boolean));
    if (scopeRoots.size === 0) scopeRoots.add(document.body);

    const attachmentSelector = "[data-testid*='attachment-chip'], [data-testid*='file-chip'], [aria-label*='attached file' i], [aria-label*='remove attachment' i]";
    const seen = new Set();
    for (const root of scopeRoots) {
      if (!root) continue;
      const candidates = Array.from(root.querySelectorAll(attachmentSelector));
      candidates.forEach(el => {
        const label = (el.innerText || el.getAttribute("aria-label") || "").trim();
        if (label) seen.add(label);
      });
    }
    return Math.min(seen.size, 20);
  }

  function getComposerText() {
    const selectors = [
      "textarea",
      "div[contenteditable='true']",
      "[role='textbox']",
      "[data-testid='chat-input-grid-container'] [contenteditable='true']",
      "[data-testid*='composer'] [contenteditable='true']"
    ];

    for (const selector of selectors) {
      const nodes = Array.from(document.querySelectorAll(selector));
      const active = nodes.find(node => node === document.activeElement || node.contains(document.activeElement));
      const node = active || nodes.reverse().find(n => (n.innerText || n.value || "").trim().length > 0);
      const text = node?.value || node?.innerText || "";
      if (text.trim()) return text.trim();
    }
    return "";
  }

  // Anthropic's models currently support up to ~200K tokens of context.
  // Carry-forward estimates must never exceed this, or long conversations
  // will show impossible, ever-climbing "context" numbers.
  const MAX_CONTEXT_WINDOW_TOKENS = 200_000;

  function getContextTokensForConversation(modelKey) {
    if (!settings.countHiddenContext) return 0;
    const conversation = usage.conversations?.[CUC.currentConversationId()] || {};
    // Use raw prompt+response size actually sent/received so far, not a
    // value that already includes previous carry-forward estimates —
    // multiplying an already-inflated running total by a ratio on every
    // message compounds it superlinearly instead of tracking real context.
    const rawPrevious = (conversation.rawInputTokens || 0) + (conversation.outputTokens || 0);
    const estimate = Math.ceil(rawPrevious * Number(settings.contextCarryForwardRatio || 0));
    return Math.min(estimate, MAX_CONTEXT_WINDOW_TOKENS);
  }

  function recordInput(text, reason = "send") {
    const clean = String(text || "").trim();
    if (!clean) return;

    const now = Date.now();
    const promptHash = hashString(clean);
    if (promptHash === lastPromptHash && now - lastPromptAt < 4000) return;
    lastPromptHash = promptHash;
    lastPromptAt = now;

    const modelKey = detectModelKey();
    const promptEstimate = CUC.estimateTokensPrecise(clean, modelKey);
    const promptTokens = promptEstimate.tokens;
    const contextTokens = getContextTokensForConversation(modelKey);
    const attachmentCount = countAttachmentChips();
    const attachmentTokens = attachmentCount * 3500;
    const rawInputTokens = Math.ceil(promptTokens + attachmentTokens);
    const inputTokens = rawInputTokens + contextTokens;
    const estimatedUsd = CUC.estimateCostUsd(inputTokens, 0, modelKey, settings);
    lastTokenEstimateMethod = promptEstimate.method;

    usage = CUC.addUsageEvent(usage, {
      at: now,
      kind: "input",
      inputTokens,
      rawInputTokens,
      outputTokens: 0,
      estimatedUsd,
      modelKey,
      attachmentCount,
      conversationId: CUC.currentConversationId(),
      title: getConversationTitle(),
      reason
    }, settings);
    saveStateSoon();
  }

  function flushOutputBuffer(reason = "stream") {
    const text = outputBuffer.trim();
    outputBuffer = "";
    if (!text) return;

    const modelKey = detectModelKey();
    const outputEstimate = CUC.estimateTokensPrecise(text, modelKey);
    const outputTokens = outputEstimate.tokens;
    lastTokenEstimateMethod = outputEstimate.method;
    const estimatedUsd = CUC.estimateCostUsd(0, outputTokens, modelKey, settings);
    usage = CUC.addUsageEvent(usage, {
      at: Date.now(),
      kind: "output",
      inputTokens: 0,
      outputTokens,
      estimatedUsd,
      modelKey,
      conversationId: CUC.currentConversationId(),
      title: getConversationTitle(),
      reason
    }, settings);
    saveStateSoon();
  }

  function isInsideComposer(el) {
    if (!el) return false;
    return Boolean(el.closest?.(
      "[data-testid*='composer'], textarea, div[contenteditable='true'], [role='textbox']"
    ));
  }

  function observeSends() {
    document.addEventListener("keydown", event => {
      const isEnterSend = event.key === "Enter" && !event.shiftKey && !event.metaKey && !event.ctrlKey && !event.altKey;
      if (!isEnterSend) return;
      // Only treat this as a "send" if Enter was pressed while focus was
      // actually inside the composer — otherwise any Enter press anywhere
      // on the page (search boxes, settings fields) gets misread as a send.
      if (!isInsideComposer(document.activeElement)) return;
      const text = getComposerText();
      setTimeout(() => recordInput(text, "keyboard-send"), 20);
    }, true);

    document.addEventListener("click", event => {
      const target = event.target;
      const button = target?.closest?.("button, [role='button']");
      if (!button) return;
      // Require the button to be near the composer AND carry a send-like
      // label. Matching "arrow" anywhere on the page (pagination, carousels)
      // was producing false-positive usage events.
      const label = `${button.getAttribute("aria-label") || ""} ${button.innerText || ""}`.toLowerCase();
      const looksLikeSend = /send message|send prompt|^send$/.test(label.trim()) || /submit/.test(label);
      const nearComposer = Boolean(button.closest("[data-testid*='composer'], form"));
      if (!looksLikeSend && !(nearComposer && /send/.test(label))) return;
      const text = getComposerText();
      setTimeout(() => recordInput(text, "button-send"), 20);
    }, true);
  }

  function observeNetworkEvents() {
    window.addEventListener("cuc:network-event", event => {
      const detail = event.detail || {};
      if (detail.kind === "response-complete" && detail.text) {
        outputBuffer += " " + detail.text;
        clearTimeout(outputFlushTimer);
        outputFlushTimer = setTimeout(() => flushOutputBuffer("network-stream"), 600);
      }
    });

    window.addEventListener("cuc:usage-snapshot", event => {
      // Placeholder for future endpoint adapter. We intentionally do not persist
      // the raw payload because it could contain account data. A future adapter
      // should normalize only percentages, reset times, and high-level usage.
      usage.lastUsageEndpointSeenAt = event.detail?.at || Date.now();
      saveStateSoon();
    });
  }

  function createWidget() {
    if (widget || !document.body) return;
    widget = document.createElement("div");
    widget.id = "cuc-widget";
    widget.innerHTML = `
      <div class="cuc-card">
        <div class="cuc-header">
          <span class="cuc-title">Vistage · Claude Usage</span>
          <div class="cuc-controls">
            <button class="cuc-button" data-cuc-action="cycle" title="Switch between dollars/tokens">$</button>
            <button class="cuc-button" data-cuc-action="collapse" aria-label="Collapse">–</button>
            <button class="cuc-button" data-cuc-action="options" title="Settings">⚙</button>
            <button class="cuc-button" data-cuc-action="hide" title="Hide">✕</button>
          </div>
        </div>
        <div class="cuc-body" data-cuc="body">
          <div class="cuc-main-row">
            <div class="cuc-main-value" data-cuc="cost">$0.00</div>
            <div class="cuc-main-label">used today<span data-cuc="tokens-inline"></span></div>
          </div>
          <div class="cuc-progress"><div class="cuc-progress-bar" data-cuc="budget-bar"></div></div>
          <div class="cuc-budget-line" data-cuc="budget-value">$0.00 of $5.00 daily budget</div>

          <div class="cuc-native" data-cuc="native-section">
            <div class="cuc-native-row" data-cuc="native-session-row">
              <div class="cuc-native-label">
                <span>Session</span>
                <span data-cuc="native-session-value">—</span>
              </div>
              <div class="cuc-progress cuc-progress--thin"><div class="cuc-progress-bar" data-cuc="native-session-bar"></div></div>
            </div>
            <div class="cuc-native-row" data-cuc="native-weekly-row">
              <div class="cuc-native-label">
                <span>Weekly</span>
                <span data-cuc="native-weekly-value">—</span>
              </div>
              <div class="cuc-progress cuc-progress--thin"><div class="cuc-progress-bar" data-cuc="native-weekly-bar"></div></div>
            </div>
            <div class="cuc-native-row" data-cuc="native-opus-row">
              <div class="cuc-native-label">
                <span>Weekly · Opus</span>
                <span data-cuc="native-opus-value">—</span>
              </div>
              <div class="cuc-progress cuc-progress--thin"><div class="cuc-progress-bar" data-cuc="native-opus-bar"></div></div>
            </div>
            <div class="cuc-native-note" data-cuc="native-note"></div>
          </div>

          <div class="cuc-footer">
            <span data-cuc="model">Model estimate</span>
            <span data-cuc="accurate-until">Accurate till 8/31</span>
          </div>
        </div>
      </div>
    `;

    placeWidget();

    if (settings.widgetCollapsed) {
      widget.classList.add("cuc-collapsed");
      const collapseBtn = widget.querySelector("[data-cuc-action='collapse']");
      if (collapseBtn) {
        collapseBtn.textContent = "+";
        collapseBtn.setAttribute("aria-label", "Expand");
      }
    }

    const header = widget.querySelector(".cuc-header");
    makeDraggable(header, widget);

    widget.addEventListener("click", async event => {
      const action = event.target?.getAttribute?.("data-cuc-action");
      if (!action) return;
      if (action === "hide") {
        settings.showWidget = false;
        await chrome.storage.local.set({ "cuc:settings": settings });
        renderWidget();
      }
      if (action === "options") {
        chrome.runtime.sendMessage({ type: "cuc:open-options" });
      }
      if (action === "collapse") {
        widget.classList.toggle("cuc-collapsed");
        const collapsed = widget.classList.contains("cuc-collapsed");
        event.target.textContent = collapsed ? "+" : "–";
        event.target.setAttribute("aria-label", collapsed ? "Expand" : "Collapse");
        settings.widgetCollapsed = collapsed;
        await chrome.storage.local.set({ "cuc:settings": settings });
      }
      if (action === "cycle") {
        const order = ["dollars", "tokens", "both"];
        const next = order[(order.indexOf(settings.displayMode) + 1) % order.length];
        settings.displayMode = next;
        await chrome.storage.local.set({ "cuc:settings": settings });
        renderWidget();
      }
    });
    renderWidget();
  }

  // Verified composer container selector (confirmed against a live,
  // actively-maintained claude.ai extension). If claude.ai changes its DOM
  // and this stops matching, placeWidget() falls back to floating mode
  // automatically rather than failing to appear at all.
  const COMPOSER_ANCHOR_SELECTOR = "[data-testid='chat-input-grid-container']";

  function findComposerAnchor() {
    return document.querySelector(COMPOSER_ANCHOR_SELECTOR);
  }

  function placeWidget() {
    if (!widget) return;

    if (settings.widgetAnchorMode === "floating") {
      placeWidgetFloating();
      return;
    }

    const anchor = findComposerAnchor();
    if (!anchor || !anchor.parentElement) {
      // Composer not found (page still loading, or claude.ai changed its
      // markup) — fail safe into floating mode rather than not appearing.
      placeWidgetFloating();
      return;
    }

    widget.classList.add("cuc-docked");
    widget.classList.remove("cuc-floating");
    widget.style.position = "";
    widget.style.top = "";
    widget.style.left = "";
    widget.style.right = "";
    widget.style.bottom = "";
    anchor.parentElement.insertBefore(widget, anchor.nextSibling);
  }

  function placeWidgetFloating() {
    if (!widget) return;
    widget.classList.add("cuc-floating");
    widget.classList.remove("cuc-docked");
    document.body.appendChild(widget);
    widget.style.position = "fixed";
    if (settings.widgetPosition && typeof settings.widgetPosition.top === "number") {
      widget.style.top = `${settings.widgetPosition.top}px`;
      widget.style.left = `${settings.widgetPosition.left}px`;
      widget.style.right = "auto";
      widget.style.bottom = "auto";
    } else {
      widget.style.right = "18px";
      widget.style.bottom = "18px";
      widget.style.top = "auto";
      widget.style.left = "auto";
    }
  }

  function makeDraggable(handle, target) {
    if (!handle || !target) return;
    let dragging = false;
    let offsetX = 0;
    let offsetY = 0;

    handle.style.cursor = "grab";

    handle.addEventListener("mousedown", event => {
      // Don't start a drag when the person is clicking one of the header buttons.
      if (event.target.closest("[data-cuc-action]")) return;
      dragging = true;

      // Capture the widget's current on-screen position BEFORE switching it
      // to fixed positioning, so the drag starts from where it visually is
      // (whether docked in the page flow or already floating) rather than
      // jumping somewhere else the instant the drag begins.
      const rect = target.getBoundingClientRect();
      if (settings.widgetAnchorMode !== "floating") {
        settings.widgetAnchorMode = "floating";
        placeWidgetFloating();
        target.style.top = `${rect.top}px`;
        target.style.left = `${rect.left}px`;
        target.style.right = "auto";
        target.style.bottom = "auto";
      }

      offsetX = event.clientX - rect.left;
      offsetY = event.clientY - rect.top;
      handle.style.cursor = "grabbing";
      event.preventDefault();
    });

    window.addEventListener("mousemove", event => {
      if (!dragging) return;
      const maxLeft = window.innerWidth - target.offsetWidth - 4;
      const maxTop = window.innerHeight - target.offsetHeight - 4;
      const left = CUC.clamp(event.clientX - offsetX, 4, Math.max(4, maxLeft));
      const top = CUC.clamp(event.clientY - offsetY, 4, Math.max(4, maxTop));
      target.style.left = `${left}px`;
      target.style.top = `${top}px`;
      target.style.right = "auto";
      target.style.bottom = "auto";
    });

    window.addEventListener("mouseup", async () => {
      if (!dragging) return;
      dragging = false;
      handle.style.cursor = "grab";
      const rect = target.getBoundingClientRect();
      settings.widgetPosition = { top: rect.top, left: rect.left };
      settings.widgetAnchorMode = "floating";
      await chrome.storage.local.set({ "cuc:settings": settings });
    });
  }

  function renderWidget() {
    if (!widget) return;
    widget.classList.toggle("cuc-hidden", !settings.showWidget);

    const totalTokens = (usage.totals?.inputTokens || 0) + (usage.totals?.outputTokens || 0);
    const progress = CUC.getBudgetProgress(usage, settings);
    const level = CUC.usageLevel(progress);
    const pct = progress.budget ? CUC.clamp((progress.value / progress.budget) * 100, 0, 100) : 0;
    const modelKey = detectModelKey();
    const model = CUC.MODEL_PRICES[modelKey] || CUC.MODEL_PRICES[settings.defaultModel];
    const effort = detectEffortLevel();
    const spend = usage.totals?.estimatedUsd || 0;

    // Main figure follows the display-mode toggle: dollars, tokens, or both
    // shown as "$1.20 · 45k tokens" — one line, not a two-card grid.
    const costText = CUC.formatUsd(spend);
    const tokensText = `${CUC.formatTokens(totalTokens)} tokens`;
    let mainValue = costText;
    let tokensInline = "";
    if (settings.displayMode === "tokens") {
      mainValue = tokensText;
    } else if (settings.displayMode === "both") {
      tokensInline = ` · ${tokensText}`;
    }

    widget.querySelector("[data-cuc='cost']").textContent = mainValue;
    widget.querySelector("[data-cuc='tokens-inline']").textContent = tokensInline;
    widget.querySelector("[data-cuc='budget-value']").textContent = `${CUC.formatUsd(progress.value)} of ${CUC.formatUsd(progress.budget)} daily budget`;
    widget.querySelector("[data-cuc='budget-bar']").style.width = `${pct}%`;
    widget.querySelector("[data-cuc='budget-bar']").className = `cuc-progress-bar ${level}`;
    widget.querySelector("[data-cuc='model']").textContent = effort
      ? `${model?.label || "Model estimate"} · ${effort} effort`
      : (model?.label || "Model estimate");
    const methodNote = lastTokenEstimateMethod === "tokenizer" ? "tokenizer estimate" : "rough estimate";
    widget.querySelector("[data-cuc='accurate-until']").textContent = `${CUC.accurateUntilLabel(modelKey)} · ${methodNote}`;

    renderNativeUsageSection();
  }

  function nativeUsageBarLevel(pct) {
    if (pct >= 90) return "high";
    if (pct >= 70) return "medium";
    return "low";
  }

  function renderNativeUsageSection() {
    const section = widget.querySelector("[data-cuc='native-section']");
    if (!section) return;

    if (!settings.showNativeLimits) {
      section.style.display = "none";
      return;
    }
    section.style.display = "block";

    const note = widget.querySelector("[data-cuc='native-note']");

    if (nativeUsageError === "not-logged-in") {
      note.textContent = "Sign in to claude.ai to see native limits.";
    } else if (nativeUsageError) {
      note.textContent = "Native limits unavailable right now.";
    } else if (!nativeUsage) {
      note.textContent = "Loading native limits…";
    } else {
      note.textContent = "";
    }

    const renderRow = (rowKey, valueKey, barKey, bucket, showRow = true) => {
      const row = widget.querySelector(`[data-cuc='${rowKey}']`);
      if (!row) return;
      if (!showRow || !bucket) {
        row.style.display = "none";
        return;
      }
      row.style.display = "block";
      const pct = CUC.clamp(bucket.utilizationPct, 0, 100);
      const resetText = CUCNative?.formatResetCountdown
        ? CUCNative.formatResetCountdown(bucket.resetsAt)
        : null;
      widget.querySelector(`[data-cuc='${valueKey}']`).textContent = resetText
        ? `${pct}% · resets in ${resetText}`
        : `${pct}%`;
      const bar = widget.querySelector(`[data-cuc='${barKey}']`);
      bar.style.width = `${pct}%`;
      bar.className = `cuc-progress-bar ${nativeUsageBarLevel(pct)}`;
    };

    renderRow("native-session-row", "native-session-value", "native-session-bar", nativeUsage?.fiveHour);
    renderRow("native-weekly-row", "native-weekly-value", "native-weekly-bar", nativeUsage?.sevenDay);
    renderRow(
      "native-opus-row",
      "native-opus-value",
      "native-opus-bar",
      nativeUsage?.sevenDayOpus,
      settings.showOpusLimit
    );
  }

  function observeSpaNavigation() {
    // Claude.ai is a client-rendered SPA — switching conversations doesn't
    // reload the page, so location.pathname changes without any of the
    // browser's native navigation events firing reliably. Patch history
    // methods and poll as a fallback so currentConversationId() and the
    // widget's model/effort readout stay in sync with the active chat.
    let lastPath = location.pathname;
    const onPathChange = () => {
      if (location.pathname === lastPath) return;
      lastPath = location.pathname;
      lastPromptHash = "";
      outputBuffer = "";
      if (settings.widgetAnchorMode !== "floating") placeWidget();
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
    setInterval(onPathChange, 1000);

    // React re-renders can replace the composer DOM node even without a
    // path change (e.g. attaching a file, switching models). If that
    // detaches our docked widget from the page, periodically check and
    // re-insert rather than leaving the widget invisible until next nav.
    setInterval(() => {
      if (!widget || settings.widgetAnchorMode === "floating") return;
      if (!document.body.contains(widget)) placeWidget();
    }, 2000);
  }

  function bootWhenReady() {
    if (document.body) {
      createWidget();
      return;
    }
    requestAnimationFrame(bootWhenReady);
  }

  async function refreshNativeUsage() {
    if (!settings.showNativeLimits || !CUCNative) return;
    try {
      nativeUsage = await CUCNative.fetchNativeUsage();
      nativeUsageError = null;
    } catch (error) {
      nativeUsage = null;
      nativeUsageError = String(error?.message || error);
    }
    try {
      await chrome.storage.local.set({
        "cuc:native-usage": nativeUsage,
        "cuc:native-usage-error": nativeUsageError
      });
    } catch {
      // best-effort; the in-page widget still has the in-memory value
    }
    renderWidget();
  }

  function observeNativeUsageRefresh() {
    refreshNativeUsage();
    clearInterval(nativeUsageTimer);
    nativeUsageTimer = setInterval(refreshNativeUsage, NATIVE_USAGE_REFRESH_MS);
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") refreshNativeUsage();
    });
  }

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    if (changes["cuc:settings"]?.newValue) {
      const previousAnchorMode = settings.widgetAnchorMode;
      settings = { ...CUC.DEFAULT_SETTINGS, ...changes["cuc:settings"].newValue };
      if (settings.widgetAnchorMode !== previousAnchorMode) placeWidget();
      renderWidget();
    }
    if (changes[STORAGE_KEY]?.newValue) {
      usage = changes[STORAGE_KEY].newValue;
      renderWidget();
    }
  });

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === "cuc:get-state") {
      sendResponse({ settings, usage, nativeUsage, nativeUsageError });
      return true;
    }
    if (message?.type === "cuc:reset-session") {
      usage = CUC.resetSession(usage, "manual");
      saveState().then(() => sendResponse({ ok: true }));
      return true;
    }
    if (message?.type === "cuc:show-widget") {
      settings.showWidget = true;
      chrome.storage.local.set({ "cuc:settings": settings }).then(() => sendResponse({ ok: true }));
      return true;
    }
    if (message?.type === "cuc:refresh-native-usage") {
      refreshNativeUsage().then(() => sendResponse({ ok: true, nativeUsage, nativeUsageError }));
      return true;
    }
    return false;
  });

  loadState().then(() => {
    injectNetworkWatcher();
    observeSends();
    observeNetworkEvents();
    observeSpaNavigation();
    observeNativeUsageRefresh();
    bootWhenReady();
  });
})();
