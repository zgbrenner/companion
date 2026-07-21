(() => {
  const FRESHNESS = globalThis.CompanionOpenAIFreshness;
  if (!FRESHNESS) return;

  const USAGE_KEY = "cuc:openai-usage";
  const WIDGET_ID = "cuc-openai-widget";
  const STYLE_MARKER = "cuc-openai-freshness-style";
  let snapshot = null;
  let rootObserver = null;
  let observedRoot = null;
  let scheduled = false;

  function setText(element, value) {
    if (element && element.textContent !== value) element.textContent = value;
  }

  function ensureStyle(root) {
    if (root.getElementById?.(STYLE_MARKER) || root.querySelector?.(`#${STYLE_MARKER}`)) return;
    const style = document.createElement("style");
    style.id = STYLE_MARKER;
    style.textContent = `
      .cuc-openai-freshness {
        display: inline-flex;
        align-items: center;
        min-height: 22px;
        padding: 2px 8px;
        border: 1px solid color-mix(in srgb, currentColor 18%, transparent);
        border-radius: 999px;
        color: var(--cuc-openai-muted, #667085);
        font-size: 11px;
        font-weight: 650;
        white-space: nowrap;
      }
      .cuc-openai-freshness[data-state="stale"] {
        color: #9a5b13;
        background: rgba(180, 105, 20, 0.08);
      }
      .cuc-openai-freshness[data-state="expired"] {
        color: #b42318;
        background: rgba(180, 35, 24, 0.08);
      }
      .cuc-openai-expired {
        padding: 12px;
        border: 1px dashed color-mix(in srgb, currentColor 24%, transparent);
        border-radius: 12px;
        color: var(--cuc-openai-muted, #667085);
        font-size: 12px;
        line-height: 1.45;
      }
      :host(.cuc-openai-dark) .cuc-openai-freshness[data-state="stale"] {
        color: #e3a34c;
        background: rgba(227, 163, 76, 0.12);
      }
      :host(.cuc-openai-dark) .cuc-openai-freshness[data-state="expired"] {
        color: #ff8a80;
        background: rgba(255, 138, 128, 0.10);
      }
    `;
    root.appendChild(style);
  }

  function ensureBadge(root) {
    let badge = root.querySelector("[data-cuc-openai='freshness']");
    if (badge) return badge;
    const live = root.querySelector("[data-cuc-openai='live']");
    if (!live?.parentElement) return null;
    badge = document.createElement("span");
    badge.className = "cuc-openai-freshness";
    badge.setAttribute("data-cuc-openai", "freshness");
    badge.setAttribute("aria-live", "polite");
    live.parentElement.insertBefore(badge, live);
    return badge;
  }

  function surfaceLabel(root) {
    const raw = root.querySelector("[data-cuc-openai='surface']")?.textContent || "OpenAI";
    return String(raw).replace(/\s+/g, " ").trim() || "OpenAI";
  }

  function apply() {
    scheduled = false;
    document.documentElement?.removeAttribute("data-companion-openai-bridge");
    const host = document.getElementById(WIDGET_ID);
    const root = host?.shadowRoot;
    if (!root) return;

    if (observedRoot !== root) {
      rootObserver?.disconnect();
      rootObserver = new MutationObserver(schedule);
      rootObserver.observe(root, { subtree: true, childList: true, characterData: true });
      observedRoot = root;
    }

    ensureStyle(root);
    const descriptor = FRESHNESS.describe(snapshot?.observedAt);
    const badge = ensureBadge(root);
    if (badge) {
      badge.hidden = descriptor.state === "missing";
      badge.dataset.state = descriptor.state;
      setText(badge, descriptor.label);
    }

    const card = root.querySelector(".cuc-openai-card");
    if (card) card.dataset.freshness = descriptor.state;
    if (!snapshot || descriptor.state === "fresh" || descriptor.state === "aging") return;

    const label = surfaceLabel(root);
    const title = root.querySelector("[data-cuc-openai='status-title']");
    const note = root.querySelector("[data-cuc-openai='status-note']");
    const rows = root.querySelector("[data-cuc-openai='rows']");

    if (descriptor.state === "stale") {
      setText(title, `${label} usage may be stale`);
      setText(note, `${descriptor.label}. Use ChatGPT to refresh the native reading.`);
      return;
    }

    setText(title, `${label} usage needs refresh`);
    setText(note, `${descriptor.label}. Companion is hiding the old values rather than presenting them as current.`);
    const expiredHtml = `<div class="cuc-openai-expired" data-cuc-openai="expired">The last native OpenAI reading is over two hours old. Use ChatGPT, Work, or a Codex-aware web surface to refresh it.</div>`;
    if (rows && rows.innerHTML !== expiredHtml) rows.innerHTML = expiredHtml;
  }

  function schedule() {
    if (scheduled) return;
    scheduled = true;
    setTimeout(apply, 0);
  }

  async function readUsage() {
    try {
      const session = await chrome.storage.session.get([USAGE_KEY]);
      if (session[USAGE_KEY]) return session[USAGE_KEY];
    } catch { /* fallback below */ }
    const local = await chrome.storage.local.get([USAGE_KEY]);
    return local[USAGE_KEY] || null;
  }

  const pageObserver = new MutationObserver(schedule);
  pageObserver.observe(document.documentElement, { subtree: true, childList: true });
  chrome.storage.onChanged.addListener((changes, area) => {
    if ((area === "session" || area === "local") && changes[USAGE_KEY]) {
      snapshot = changes[USAGE_KEY].newValue || null;
      schedule();
    }
  });

  readUsage().then(value => {
    snapshot = value;
    schedule();
  }).catch(schedule);
  setInterval(schedule, 30_000);
  schedule();
})();
