(() => {
  const CUC = globalThis.ClaudeUsageCompanion;
  const CUCNative = globalThis.ClaudeUsageCompanionNative;
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
  // Newest version published on GitHub, recorded by the background's update
  // checker; drives the "Update ready" banner at the top of the widget.
  let updateAvailableVersion = null;
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
    const stored = await chrome.storage.local.get(["cuc:settings", "cuc:update-available", "cuc:spend-days"]);
    settings = { ...CUC.DEFAULT_SETTINGS, ...(stored["cuc:settings"] || {}) };
    updateAvailableVersion = stored["cuc:update-available"]?.latestVersion || null;
    spendDays = stored["cuc:spend-days"] || null;
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
          <span class="cuc-title">Vistage · Claude Companion</span>
          <div class="cuc-controls">
            <button class="cuc-button" data-cuc-action="cycle" title="Switch between dollars/tokens" aria-label="Switch display between dollars, tokens, and both">$</button>
            <button class="cuc-button" data-cuc-action="options" title="Settings" aria-label="Open settings">⚙</button>
            <button class="cuc-button" data-cuc-action="hide" title="Hide" aria-label="Hide usage widget">✕</button>
          </div>
        </div>
        <button class="cuc-update" data-cuc="update-banner" data-cuc-action="update" hidden></button>
        <div class="cuc-body" data-cuc="body">
          <div class="cuc-meter">
            <div class="cuc-meter-label">
              <span title="Your real usage-credit spend since you opened your browser — read straight from Claude's own monthly counter, accurate to the cent. Covers ALL your Claude activity in that time (every tab and device on your account), not just this chat. Token figures are a range derived from this real spend using current Anthropic pricing.">Spent this session</span>
              <span data-cuc="session-value" aria-live="polite">—</span>
            </div>
            <div class="cuc-progress" role="progressbar" aria-label="Session spend as a share of the monthly allowance" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0">
              <div class="cuc-progress-bar" data-cuc="session-bar"></div>
            </div>
            <div class="cuc-budget-line" data-cuc="session-detail" hidden></div>
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

          <div class="cuc-tip" data-cuc="tip" hidden></div>

          <div class="cuc-footer">
            <span data-cuc="model" title="The model detected in this chat — used to convert real dollars into the approximate token range.">Model</span>
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
      const action = event.target?.getAttribute?.("data-cuc-action");
      if (!action) return;
      if (action === "hide") {
        settings.showWidget = false;
        await chrome.storage.local.set({ "cuc:settings": settings });
        renderWidget();
      }
      if (action === "options" || action === "update") {
        // The update banner routes to the options page too — that's where the
        // one-click installer lives.
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
      const low = rows.reduce((s, r) => s + CUC.estimateTokensFromSpend(r.spendUsd, r.modelKey || modelKey, { inputOutputRatio: 3, cacheReadFraction: 0 }), 0);
      const high = rows.reduce((s, r) => s + CUC.estimateTokensFromSpend(r.spendUsd, r.modelKey || modelKey, { inputOutputRatio: 12, cacheReadFraction: 0.5 }), 0);
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

    const modelKey = detectModelKey();
    const model = CUC.MODEL_PRICES[CUC.resolveModelKey(modelKey)] || CUC.MODEL_PRICES[CUC.resolveModelKey(settings.defaultModel)];
    const effort = detectEffortLevel();

    const cycleButton = widgetRoot.querySelector("[data-cuc-action='cycle']");
    if (cycleButton) cycleButton.textContent = DISPLAY_MODE_GLYPHS[settings.displayMode] || "$";

    // Update banner: shown while GitHub has a newer version than the one
    // running. The inequality check auto-hides it once the update applies,
    // even before the background clears the stored flag.
    const updateBanner = widgetRoot.querySelector("[data-cuc='update-banner']");
    if (updateBanner) {
      const runningVersion = chrome.runtime.getManifest().version;
      const showBanner = Boolean(updateAvailableVersion) && updateAvailableVersion !== runningVersion;
      updateBanner.hidden = !showBanner;
      if (showBanner) updateBanner.textContent = `Update v${updateAvailableVersion} is ready — click to install`;
    }

    // "Spent this session" — Claude's own counter, sampled at session start
    // and on every poll/response since.
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
      const limitUsd = nativeUsage?.monthlySpendLimit?.limitUsd;
      setBar(sessionBar, limitUsd > 0 ? (deltaUsd / limitUsd) * 100 : 0);

      const today = todaySpendInfo();
      if (today && today.spendUsd >= 0.005 && Math.abs(today.spendUsd - deltaUsd) >= 0.005) {
        sessionDetailEl.textContent = `Today: ${spendValueText(today.spendUsd, modelKey, today.rows)}`;
        sessionDetailEl.hidden = false;
      } else {
        sessionDetailEl.hidden = true;
      }
    }

    widgetRoot.querySelector("[data-cuc='model']").textContent = effort
      ? `${model?.label || "Model"} · ${effort} effort`
      : (model?.label || "Model");

    renderNativeLimits();
    renderTip();
  }

  function nativeUsageBarLevel(pct) {
    if (pct >= 90) return "high";
    if (pct >= 70) return "medium";
    return "low";
  }

  // Update a progress bar's fill, color, and the aria-valuenow on its
  // role="progressbar" container in one place.
  function setBar(bar, pct) {
    if (!bar) return;
    const clamped = CUC.clamp(pct, 0, 100);
    bar.style.width = `${clamped}%`;
    bar.className = `cuc-progress-bar ${nativeUsageBarLevel(clamped)}`;
    bar.parentElement?.setAttribute?.("aria-valuenow", String(Math.round(clamped)));
  }

  // The three rolling-limit buckets Claude itself reports. These are what
  // actually locks a person out mid-workday, so they get first-class rows.
  const NATIVE_BUCKETS = [
    { key: "five-hour", prop: "fiveHour", label: "Session limit" },
    { key: "seven-day", prop: "sevenDay", label: "Weekly limit" },
    { key: "opus", prop: "sevenDayOpus", label: "Weekly Opus limit" }
  ];

  function bucketValueText(bucket) {
    const pct = Math.round(CUC.clamp(bucket.utilizationPct, 0, 100));
    const countdown = CUCNative?.formatResetCountdown ? CUCNative.formatResetCountdown(bucket.resetsAt) : null;
    return countdown ? `${pct}% · resets in ${countdown}` : `${pct}%`;
  }

  // Returns the most urgent plain-English warning across all native buckets,
  // or null when everything is comfortably below the warning threshold.
  function mostUrgentNativeWarning(native) {
    if (!native) return null;
    const candidates = [];
    for (const { prop, label } of NATIVE_BUCKETS) {
      const bucket = native[prop];
      if (bucket && typeof bucket.utilizationPct === "number") {
        candidates.push({ pct: bucket.utilizationPct, label, resetsAt: bucket.resetsAt });
      }
    }
    const spend = native.monthlySpendLimit;
    if (spend) candidates.push({ pct: spend.utilizationPct, label: "Monthly allowance", resetsAt: null });

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

    if (!settings.showNativeLimits) {
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

    // Rolling limits (session/weekly/Opus) — Claude's own numbers.
    for (const { key, prop } of NATIVE_BUCKETS) {
      const row = rows[key];
      if (!row) continue;
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
      widgetRoot.querySelector(`[data-cuc='${key}-value']`).textContent = bucketValueText(bucket);
      setBar(widgetRoot.querySelector(`[data-cuc='${key}-bar']`), bucket.utilizationPct);
    }

    // Monthly usage-credit allowance.
    const spendLimit = nativeUsage.monthlySpendLimit;
    if (!spendLimit) {
      if (enterpriseRow) enterpriseRow.hidden = true;
      setNote(mostUrgentNativeWarning(nativeUsage));
      return;
    }
    if (enterpriseRow) enterpriseRow.hidden = false;
    const pct = CUC.clamp(spendLimit.utilizationPct, 0, 100);
    const resetLabel = CUCNative?.formatResetLabel ? CUCNative.formatResetLabel(spendLimit) : null;
    enterpriseValue.textContent = resetLabel
      ? `${CUC.formatUsd(spendLimit.usedUsd)} of ${CUC.formatUsd(spendLimit.limitUsd)} · ${resetLabel}`
      : `${CUC.formatUsd(spendLimit.usedUsd)} of ${CUC.formatUsd(spendLimit.limitUsd)}`;
    setBar(enterpriseBar, pct);

    if (spendLimit.outOfCredits) {
      setNote("Monthly usage-credit limit reached");
    } else if (spendLimit.capAdvisory) {
      setNote(`Cap differs from expected ${CUC.formatUsd(spendLimit.capAdvisory.expectedLimitUsd)} — update Settings if this changed.`);
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
    if (!settings.showPlainEnglishTips || !settings.showNativeLimits) {
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

  function maxNativeUtilizationPct(native) {
    if (!native) return null;
    const values = [];
    for (const prop of ["fiveHour", "sevenDay", "sevenDayOpus"]) {
      const bucket = native[prop];
      if (bucket && typeof bucket.utilizationPct === "number") values.push(bucket.utilizationPct);
    }
    if (typeof native.monthlySpendLimit?.utilizationPct === "number") {
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
    const push = (key, label, bucket) => {
      if (bucket && typeof bucket.utilizationPct === "number") {
        rows.push({ key, label, pct: bucket.utilizationPct, resetsAt: bucket.resetsAt || null });
      }
    };
    push("five-hour", "Session limit", nativeUsage.fiveHour);
    push("seven-day", "Weekly limit", nativeUsage.sevenDay);
    push("opus", "Weekly Opus limit", nativeUsage.sevenDayOpus);
    push("monthly", "Monthly allowance", nativeUsage.monthlySpendLimit);
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
    if (!settings.showNativeLimits || !CUCNative) {
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
      settings = { ...CUC.DEFAULT_SETTINGS, ...changes["cuc:settings"].newValue };
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
    if ("cuc:update-available" in changes) {
      updateAvailableVersion = changes["cuc:update-available"].newValue?.latestVersion || null;
      renderWidget();
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
    bootWhenReady();
  });
})();
