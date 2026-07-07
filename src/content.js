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
  let outputBufferConversationId = null;
  let outputBufferModelKey = null;
  let outputFlushTimer = null;
  let saveTimer = null;
  let nativeUsage = null;
  let nativeUsageError = null;
  let nativeUsageTimer = null;
  let lastTokenEstimateMethod = "heuristic";
  let lastUsageSnapshotRefreshAt = 0;
  let networkDetectedModelKey = null;
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
    usage = CUC.normalizeUsage(stored[STORAGE_KEY]);
    // Let the background (single writer) perform any stale-session reset, so two
    // tabs loading at once don't both reset. The fresh state returns via
    // storage.onChanged; we don't write from here.
    if (CUC.shouldResetSession(usage, settings)) {
      chrome.runtime.sendMessage({ type: "cuc:maybe-reset-session" }).catch(() => {});
    }
  }

  function saveStateSoon() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveState, 250);
  }

  // Send a usage delta to the background service worker, which is the single
  // serialized writer of the usage aggregate — this is what makes concurrent
  // usage from multiple claude.ai tabs safe (no lost updates). We do NOT mutate
  // local `usage` here; the authoritative new state comes back via
  // storage.onChanged and re-renders every tab. If the worker is somehow
  // unreachable, fall back to a local write so a single-tab user never loses an
  // event (multi-tab safety is best-effort only in that rare window).
  function recordEvent(event) {
    // Stable unique id so the event is idempotent: if the fallback fires after
    // the background already applied it (lost acknowledgement), addUsageEvent
    // dedupes on this id instead of double-counting.
    event.id = event.id || `${event.at || Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

    // Optimistically fold the event into local state right away. Two reasons:
    // (1) instant widget feedback instead of waiting for the background write +
    // storage.onChanged round-trip; (2) a rapid follow-up send computes its
    // carry-forward context (getContextTokensForConversation reads local
    // `usage`) against this event instead of a stale copy. This is display/
    // compute-only — content never writes the usage blob on the normal path;
    // the authoritative state still arrives via onChanged, and addUsageEvent is
    // idempotent on event.id, so the optimistic apply is never double-counted.
    usage = CUC.addUsageEvent(usage, event, settings);
    renderWidget();

    let settled = false;
    const fallback = async () => {
      if (settled) return;
      settled = true;
      // Re-read the freshest stored state before applying, so this best-effort
      // local write doesn't clobber events another tab committed in the
      // meantime. addUsageEvent is idempotent on event.id.
      try {
        const stored = await chrome.storage.local.get([STORAGE_KEY]);
        usage = CUC.addUsageEvent(CUC.normalizeUsage(stored[STORAGE_KEY]) || usage, event, settings);
      } catch {
        usage = CUC.addUsageEvent(usage, event, settings);
      }
      saveStateSoon();
    };
    try {
      chrome.runtime.sendMessage({ type: "cuc:record-event", event })
        .then(response => { if (!response?.ok) fallback(); })
        .catch(fallback);
    } catch {
      fallback();
    }
  }

  async function saveState() {
    usage.lastUpdatedAt = Date.now();
    try {
      await chrome.storage.local.set({ [STORAGE_KEY]: usage });
    } catch (error) {
      // Most likely QUOTA_BYTES. pruneUsage() bounds growth so this should be
      // rare, but if it happens, drop the coldest history and retry once so new
      // usage keeps persisting rather than silently failing forever.
      CUC.pruneUsage(usage);
      usage.recentEvents = (usage.recentEvents || []).slice(0, 10);
      try {
        await chrome.storage.local.set({ [STORAGE_KEY]: usage });
      } catch {
        // Give up on this write; in-memory state still drives the widget.
      }
    }
    renderWidget();
  }

  function detectModelKey() {
    if (networkDetectedModelKey) return networkDetectedModelKey;
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

  function recordInput(text, reason = "send", attachmentCountArg = null) {
    const clean = String(text || "").trim();
    // Count attachments from the argument if the caller snapshotted them at
    // send time (the composer chips are often torn out of the DOM within a few
    // ms of sending, so counting them here — after the delay — would read 0).
    const attachmentCount = attachmentCountArg != null ? attachmentCountArg : countAttachmentChips();
    // Allow attachment-only sends (a file with no typed prompt). Only bail when
    // there is genuinely nothing to record.
    if (!clean && attachmentCount === 0) return;

    const now = Date.now();
    // Dedupe on prompt text + attachment count so an attachment-only send (empty
    // text) isn't collapsed with the next one.
    const promptHash = hashString(`${clean} ${attachmentCount}`);
    if (promptHash === lastPromptHash && now - lastPromptAt < 4000) return;
    lastPromptHash = promptHash;
    lastPromptAt = now;

    const modelKey = detectModelKey();
    const promptEstimate = CUC.estimateTokensPrecise(clean, modelKey);
    const promptTokens = promptEstimate.tokens;
    const contextTokens = getContextTokensForConversation(modelKey);
    const attachmentTokens = attachmentCount * 3500;
    const rawInputTokens = Math.ceil(promptTokens + attachmentTokens);
    const inputTokens = rawInputTokens + contextTokens;
    const estimatedUsd = CUC.estimateCostUsd(inputTokens, 0, modelKey, settings);
    lastTokenEstimateMethod = promptEstimate.method;

    recordEvent({
      at: now,
      kind: "input",
      inputTokens,
      rawInputTokens,
      outputTokens: 0,
      estimatedUsd,
      modelKey,
      attachmentCount,
      conversationId: CUC.currentConversationId(),
      reason
    });
  }

  function flushOutputBuffer(reason = "stream") {
    const text = outputBuffer.trim();
    // Attribute output to the model/conversation active when the stream was
    // captured, not whatever is on screen at flush time — the user may have
    // switched chats during the debounce window.
    const modelKey = outputBufferModelKey || detectModelKey();
    const conversationId = outputBufferConversationId || CUC.currentConversationId();
    outputBuffer = "";
    outputBufferConversationId = null;
    outputBufferModelKey = null;
    clearTimeout(outputFlushTimer);
    if (!text) return;

    const outputEstimate = CUC.estimateTokensPrecise(text, modelKey);
    const outputTokens = outputEstimate.tokens;
    lastTokenEstimateMethod = outputEstimate.method;
    const estimatedUsd = CUC.estimateCostUsd(0, outputTokens, modelKey, settings);
    recordEvent({
      at: Date.now(),
      kind: "output",
      inputTokens: 0,
      outputTokens,
      estimatedUsd,
      modelKey,
      conversationId,
      reason
    });
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
      // Snapshot text AND attachment count now, before the composer clears.
      const text = getComposerText();
      const attachmentCount = countAttachmentChips();
      setTimeout(() => recordInput(text, "keyboard-send", attachmentCount), 20);
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
      const attachmentCount = countAttachmentChips();
      setTimeout(() => recordInput(text, "button-send", attachmentCount), 20);
    }, true);
  }

  function observeNetworkEvents() {
    window.addEventListener("cuc:network-event", event => {
      const detail = event.detail || {};
      if (detail.kind === "model-detected" && detail.modelId) {
        const detected = CUC.detectModelFromId(detail.modelId) || CUC.detectModelFromText(detail.modelId);
        if (detected) {
          networkDetectedModelKey = detected;
          renderWidget();
        }
      }
      if (detail.kind === "response-complete" && detail.text) {
        // Capture attribution at the moment the stream arrives, before any
        // SPA navigation can change the active conversation/model underneath us.
        if (!outputBuffer) {
          outputBufferConversationId = CUC.currentConversationId();
          outputBufferModelKey = detectModelKey();
        }
        outputBuffer += " " + detail.text;
        clearTimeout(outputFlushTimer);
        outputFlushTimer = setTimeout(() => flushOutputBuffer("network-stream"), 600);
      }
    });

    window.addEventListener("cuc:usage-snapshot", () => {
      // claude.ai just fetched its own usage data, so ours may be stale —
      // refresh opportunistically (throttled). We never persist the raw payload
      // (it's not even forwarded across the world boundary anymore), and we do
      // not write the usage aggregate from here: the background is the single
      // writer, so a content-side write would reintroduce the multi-tab race.
      const now = Date.now();
      if (now - lastUsageSnapshotRefreshAt < 15000) return;
      lastUsageSnapshotRefreshAt = now;
      refreshNativeUsage();
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
            <button class="cuc-button" data-cuc-action="options" title="Settings">⚙</button>
            <button class="cuc-button" data-cuc-action="hide" title="Hide">✕</button>
          </div>
        </div>
        <div class="cuc-body" data-cuc="body">
          <div class="cuc-meter">
            <div class="cuc-meter-label">
              <span>Usage in this chat</span>
              <span data-cuc="chat-value">$0.00</span>
            </div>
            <div class="cuc-progress"><div class="cuc-progress-bar" data-cuc="chat-bar"></div></div>
            <div class="cuc-budget-line" data-cuc="chat-detail">0 tokens · ballpark estimate</div>
          </div>

          <div class="cuc-meter" data-cuc="enterprise-section">
            <div class="cuc-meter-label">
              <span>Enterprise limit</span>
              <span data-cuc="enterprise-value">—</span>
            </div>
            <div class="cuc-progress"><div class="cuc-progress-bar" data-cuc="enterprise-bar"></div></div>
            <div class="cuc-budget-line" data-cuc="enterprise-note">Loading Claude usage…</div>
          </div>

          <div class="cuc-footer">
            <span data-cuc="model">Model estimate</span>
            <span data-cuc="accurate-until">Accurate till 8/31</span>
          </div>
        </div>
      </div>
    `;

    placeWidget();

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

  const COMPOSER_ANCHOR_SELECTORS = [
    "[data-testid='chat-input-grid-container']",
    "[data-testid*='chat-input']",
    "[data-testid*='composer']",
    "form:has(textarea)",
    "form:has([contenteditable='true'])"
  ];

  function findComposerAnchor() {
    for (const selector of COMPOSER_ANCHOR_SELECTORS) {
      try {
        const anchor = document.querySelector(selector);
        if (anchor) return anchor;
      } catch {
        // Ignore unsupported selector variants and try the next one.
      }
    }
    return null;
  }

  function placeWidget() {
    if (!widget) return;

    const anchor = findComposerAnchor();
    const dockTarget = anchor?.closest?.("form, [data-testid*='composer']") || anchor;
    if (!dockTarget || !dockTarget.parentElement) {
      widget.remove();
      return;
    }

    widget.classList.add("cuc-docked");
    widget.style.position = "";
    widget.style.top = "";
    widget.style.left = "";
    widget.style.right = "";
    widget.style.bottom = "";
    dockTarget.parentElement.insertBefore(widget, dockTarget.nextSibling);
  }

  function renderWidget() {
    if (!widget) return;
    widget.classList.toggle("cuc-hidden", !settings.showWidget);

    const conversation = CUC.getConversationUsage(usage);
    const chatTokens = (conversation.inputTokens || 0) + (conversation.outputTokens || 0);
    const modelKey = detectModelKey();
    const model = CUC.MODEL_PRICES[modelKey] || CUC.MODEL_PRICES[settings.defaultModel];
    const effort = detectEffortLevel();
    const chatSpend = conversation.estimatedUsd || 0;

    const chatCostText = CUC.formatUsd(chatSpend);
    const chatTokensText = `${CUC.formatTokens(chatTokens)} tokens`;
    let chatValue = chatCostText;
    let chatDetail = `${chatTokensText} · ballpark estimate`;
    if (settings.displayMode === "tokens") {
      chatValue = chatTokensText;
      chatDetail = `${chatCostText} · ballpark estimate`;
    } else if (settings.displayMode === "both") {
      chatValue = `${chatCostText} · ${chatTokensText}`;
      chatDetail = "Ballpark estimate for this chat";
    }

    const chatPct = CUC.clamp((chatTokens / MAX_CONTEXT_WINDOW_TOKENS) * 100, 0, 100);
    widget.querySelector("[data-cuc='chat-value']").textContent = chatValue;
    widget.querySelector("[data-cuc='chat-detail']").textContent = chatDetail;
    widget.querySelector("[data-cuc='chat-bar']").style.width = `${chatPct}%`;
    widget.querySelector("[data-cuc='chat-bar']").className = `cuc-progress-bar ${nativeUsageBarLevel(chatPct)}`;

    widget.querySelector("[data-cuc='model']").textContent = effort
      ? `${model?.label || "Model estimate"} · ${effort} effort`
      : (model?.label || "Model estimate");
    const methodNote = lastTokenEstimateMethod === "tokenizer" ? "tokenizer estimate" : "rough estimate";
    widget.querySelector("[data-cuc='accurate-until']").textContent = `${CUC.accurateUntilLabel(modelKey)} · ${methodNote}`;

    renderEnterpriseLimit();
  }

  function nativeUsageBarLevel(pct) {
    if (pct >= 90) return "high";
    if (pct >= 70) return "medium";
    return "low";
  }

  function renderEnterpriseLimit() {
    const section = widget.querySelector("[data-cuc='enterprise-section']");
    if (!section) return;

    if (!settings.showNativeLimits) {
      section.style.display = "none";
      return;
    }
    section.style.display = "block";

    const note = widget.querySelector("[data-cuc='enterprise-note']");
    const value = widget.querySelector("[data-cuc='enterprise-value']");
    const bar = widget.querySelector("[data-cuc='enterprise-bar']");

    if (nativeUsageError === "not-logged-in") {
      note.textContent = "Sign in to claude.ai to see native limits.";
      value.textContent = "—";
      bar.style.width = "0%";
    } else if (nativeUsageError) {
      note.textContent = "Native limits unavailable right now.";
      value.textContent = "—";
      bar.style.width = "0%";
    } else if (!nativeUsage) {
      note.textContent = "Loading Claude usage…";
      value.textContent = "—";
      bar.style.width = "0%";
    } else {
      const spendLimit = nativeUsage.monthlySpendLimit;
      if (!spendLimit) {
        note.textContent = nativeUsage.monthlySpendLimitRejected
          ? `Claude returned ${CUC.formatUsd(nativeUsage.monthlySpendLimitRejected.foundLimitUsd)}, expected ${CUC.formatUsd(nativeUsage.monthlySpendLimitRejected.expectedLimitUsd)}.`
          : "Employee monthly spend limit unavailable right now.";
        value.textContent = "—";
        bar.style.width = "0%";
        return;
      }
      const pct = CUC.clamp(spendLimit.utilizationPct, 0, 100);
      const resetText = CUCNative?.formatResetCountdown
        ? CUCNative.formatResetCountdown(spendLimit.resetsAt)
        : null;
      value.textContent = resetText
        ? `${CUC.formatUsd(spendLimit.usedUsd)} of ${CUC.formatUsd(spendLimit.limitUsd)} · resets in ${resetText}`
        : `${CUC.formatUsd(spendLimit.usedUsd)} of ${CUC.formatUsd(spendLimit.limitUsd)}`;
      bar.style.width = `${pct}%`;
      bar.className = `cuc-progress-bar ${nativeUsageBarLevel(pct)}`;
      note.textContent = spendLimit.outOfCredits
        ? "Monthly usage-credit limit reached"
        : "Monthly usage-credit spend from Claude.ai";
    }
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
      // Flush any buffered output for the chat we're leaving — it's attributed
      // to the captured conversation id, so it lands on the right chat rather
      // than being silently discarded.
      flushOutputBuffer("navigation");
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
    // pushState/replaceState/popstate already cover the common cases, so this
    // can be slow, and it skips work entirely while the tab is backgrounded.
    setInterval(() => { if (!document.hidden) onPathChange(); }, 2000);

    // React re-renders can replace the composer DOM node even without a
    // path change (e.g. attaching a file, switching models). If that
    // detaches our docked widget from the page, re-insert it. Skipped while
    // the tab is hidden so backgrounded tabs don't poll the DOM forever.
    setInterval(() => {
      if (document.hidden || !widget) return;
      const anchor = findComposerAnchor();
      const dockTarget = anchor?.closest?.("form, [data-testid*='composer']") || anchor;
      const isDockedAfterAnchor = dockTarget?.parentElement && widget.parentElement === dockTarget.parentElement && widget.previousElementSibling === dockTarget;
      if (!document.body.contains(widget) || !isDockedAfterAnchor) placeWidget();
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
    // Don't poll the usage endpoint while the tab is backgrounded; the
    // visibilitychange handler below refreshes immediately on return.
    nativeUsageTimer = setInterval(() => {
      if (!document.hidden) refreshNativeUsage();
    }, NATIVE_USAGE_REFRESH_MS);
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") refreshNativeUsage();
    });
  }

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    if (changes["cuc:settings"]?.newValue) {
      settings = { ...CUC.DEFAULT_SETTINGS, ...changes["cuc:settings"].newValue };
      placeWidget();
      renderWidget();
    }
    if (changes[STORAGE_KEY]?.newValue) {
      usage = CUC.normalizeUsage(changes[STORAGE_KEY].newValue);
      renderWidget();
    }
  });

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === "cuc:get-state") {
      sendResponse({ settings, usage, nativeUsage, nativeUsageError, conversationId: CUC.currentConversationId() });
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
