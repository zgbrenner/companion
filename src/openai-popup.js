(() => {
  const USAGE_KEY = "cuc:openai-usage";
  const FRESHNESS = globalThis.CompanionOpenAIFreshness;
  const SURFACES = {
    chat: { label: "Chat", title: "ChatGPT native usage" },
    work: { label: "Work", title: "Work agentic usage" },
    codex: { label: "Codex compatibility", title: "Legacy Codex route usage" },
  };
  const activeSurface = (() => {
    try {
      const value = new URL(location.href).searchParams.get("surface");
      return ["chat", "work", "codex"].includes(value) ? value : null;
    } catch {
      return null;
    }
  })();
  let currentSnapshot = null;

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function formatNumber(value, fraction = 1) {
    return new Intl.NumberFormat(undefined, { maximumFractionDigits: fraction }).format(value);
  }

  function formatValue(bucket) {
    if (bucket.used == null) return `${formatNumber(bucket.pct)}%`;
    if (bucket.unit === "usd") {
      return bucket.limit ? `$${Number(bucket.used).toFixed(2)} / $${Number(bucket.limit).toFixed(2)}` : `$${Number(bucket.used).toFixed(2)}`;
    }
    const suffix = bucket.unit === "credits" ? " credits" : bucket.unit === "messages" ? " messages" : bucket.unit === "tokens" ? " tokens" : "";
    return bucket.limit
      ? `${formatNumber(bucket.used)} / ${formatNumber(bucket.limit)}${suffix}`
      : `${formatNumber(bucket.used)}${suffix}`;
  }

  function resetText(value) {
    const reset = Date.parse(value || "");
    if (!Number.isFinite(reset)) return "";
    const minutes = Math.round((reset - Date.now()) / 60000);
    if (minutes <= 0) return "Reset pending";
    if (minutes < 60) return `Resets in ${minutes}m`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `Resets in ${hours}h ${minutes % 60}m`;
    return `Resets in ${Math.floor(hours / 24)}d ${hours % 24}h`;
  }

  function render(snapshot) {
    currentSnapshot = snapshot || null;
    const surfaceKey = activeSurface || (["chat", "work", "codex"].includes(snapshot?.surface) ? snapshot.surface : "chat");
    const meta = SURFACES[surfaceKey];
    document.body.dataset.surface = surfaceKey;
    document.getElementById("surface").innerHTML = `<span aria-hidden="true"></span>${meta.label}`;

    const title = document.getElementById("hero-title");
    const note = document.getElementById("hero-note");
    const freshness = document.getElementById("freshness");
    const rows = document.getElementById("rows");
    const descriptor = FRESHNESS?.describe?.(snapshot?.observedAt) || {
      state: snapshot ? "expired" : "missing",
      label: snapshot ? "Timestamp unavailable" : "Not observed yet",
      showValues: false,
      warn: Boolean(snapshot),
    };

    freshness.dataset.state = descriptor.state;
    freshness.textContent = descriptor.label;

    if (!snapshot) {
      title.textContent = "Watching for OpenAI data";
      note.textContent = "COMPANION shows only numeric usage that OpenAI exposes. No estimates and no message scraping.";
      rows.innerHTML = `<div class="empty">Use ChatGPT Chat or Work. Usage appears here as soon as OpenAI returns a supported counter or limit.</div>`;
      return;
    }

    if (!descriptor.showValues) {
      title.textContent = `${meta.label} usage needs refresh`;
      note.textContent = descriptor.state === "expired"
        ? "The last native reading is too old to present as current, so COMPANION is hiding it."
        : "This native usage reading has no trustworthy observation time, so COMPANION is hiding it.";
      rows.innerHTML = `<div class="empty">Use ChatGPT Chat or Work to collect a fresh native usage reading.</div>`;
      return;
    }

    title.textContent = descriptor.state === "stale" ? `${meta.label} usage may be stale` : meta.title;
    note.textContent = descriptor.state === "stale"
      ? `${descriptor.label}. Use ChatGPT to refresh the native reading.`
      : "Read from OpenAI's own first-party usage responses and stored locally on this device.";

    const buckets = Array.isArray(snapshot.buckets) ? snapshot.buckets : [];
    const tokenCounter = snapshot.counters?.tokens;
    const bucketHtml = buckets.map(bucket => {
      const pct = Math.max(0, Math.min(100, Number(bucket.pct) || 0));
      const reset = resetText(bucket.resetsAt);
      return `<article class="row">
        <div class="row-head">
          <span class="label">${escapeHtml(bucket.label)}</span>
          <span class="value">${escapeHtml(formatValue(bucket))}</span>
        </div>
        <div class="progress" role="progressbar" aria-label="${escapeHtml(bucket.label)}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(pct)}"><span style="width:${pct}%"></span></div>
        ${reset ? `<div class="reset">${escapeHtml(reset)}</div>` : ""}
      </article>`;
    }).join("");
    const tokensHtml = tokenCounter && Number.isFinite(tokenCounter.total)
      ? `<article class="row"><div class="row-head"><span class="label">Observed tokens</span><span class="value">${escapeHtml(formatNumber(tokenCounter.total, 0))}</span></div><div class="reset">${tokenCounter.input != null ? `${escapeHtml(formatNumber(tokenCounter.input, 0))} input` : ""}${tokenCounter.input != null && tokenCounter.output != null ? " · " : ""}${tokenCounter.output != null ? `${escapeHtml(formatNumber(tokenCounter.output, 0))} output` : ""}</div></article>`
      : "";
    const creditBalance = snapshot.balances?.credits;
    const balanceHtml = creditBalance && Number.isFinite(creditBalance.balance)
      ? `<article class="row"><div class="row-head"><span class="label">Credits balance</span><span class="value">${escapeHtml(creditBalance.unlimited ? "Unlimited" : `${formatNumber(creditBalance.balance)} credits`)}</span></div></article>`
      : "";
    rows.innerHTML = bucketHtml || tokensHtml || balanceHtml
      ? `${bucketHtml}${tokensHtml}${balanceHtml}`
      : `<div class="empty">This response contained no supported numeric usage fields.</div>`;
  }

  async function readUsage() {
    try {
      const session = await chrome.storage.session.get([USAGE_KEY]);
      if (session[USAGE_KEY]) return session[USAGE_KEY];
    } catch {
      // storage.session may be unavailable in older Chromium builds.
    }
    const local = await chrome.storage.local.get([USAGE_KEY]);
    return local[USAGE_KEY] || null;
  }

  document.getElementById("settings").addEventListener("click", () => chrome.runtime.openOptionsPage());
  chrome.storage.onChanged.addListener((changes, area) => {
    if ((area === "session" || area === "local") && changes[USAGE_KEY]) render(changes[USAGE_KEY].newValue || null);
  });
  readUsage().then(render).catch(() => render(null));
  setInterval(() => render(currentSnapshot), 30_000);
})();
