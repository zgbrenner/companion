const CUC = globalThis.ClaudeUsageCompanion;
const CUCNative = globalThis.ClaudeUsageCompanionNative;

// Every persisted setting keyed by the control's data-setting attribute.
const BOOLEAN_SETTINGS = new Set([
  "showWidget", "showCavemanMode", "showMonthlyCredits", "desktopNotifications", "showPlainEnglishTips",
  "showSessionSpend", "showSessionLimit", "showWeeklyLimit", "showOpusLimit"
]);

let detectedOrganizationId = null;
let organizationRevealed = false;

// ---- Save-status bar -------------------------------------------------------

let saveStatusTimer = null;
function flashSaved() {
  const el = document.getElementById("save-status");
  if (!el) return;
  el.classList.remove("saving");
  el.textContent = "All changes saved";
}
function flashSaving() {
  const el = document.getElementById("save-status");
  if (!el) return;
  el.classList.add("saving");
  el.textContent = "Saving…";
}

async function updateSetting(key, value) {
  flashSaving();
  try {
    const stored = await chrome.storage.local.get(["cuc:settings"]);
    // Merge onto CURRENT stored settings so keys not shown here are preserved.
    const settings = { ...CUC.mergeSettings(stored["cuc:settings"]), [key]: value };
    await chrome.storage.local.set({ "cuc:settings": settings });
    clearTimeout(saveStatusTimer);
    saveStatusTimer = setTimeout(flashSaved, 220);
  } catch {
    const el = document.getElementById("save-status");
    if (el) { el.classList.remove("saving"); el.textContent = "Couldn't save — try again"; }
  }
}

// ---- Model selector (no pricing jargon) ------------------------------------

function cleanModelName(label) {
  return String(label || "").split(" — ")[0].trim();
}

function populateModels() {
  const select = document.getElementById("defaultModel");
  select.innerHTML = "";
  const seen = new Set();
  for (const [key, model] of Object.entries(CUC.MODEL_PRICES)) {
    const name = cleanModelName(model.label);
    if (seen.has(name)) continue; // collapse intro/standard duplicates
    seen.add(name);
    const option = document.createElement("option");
    option.value = key;
    option.textContent = name;
    option.dataset.clean = name;
    select.appendChild(option);
  }
}

function setModelValue(select, value) {
  const wanted = String(value || "");
  if ([...select.options].some(o => o.value === wanted)) {
    select.value = wanted;
    return;
  }
  // Stored key isn't a listed option (e.g. the -standard twin) — match by name.
  const targetName = cleanModelName(CUC.MODEL_PRICES[wanted]?.label || CUC.MODEL_PRICES[CUC.resolveModelKey(wanted)]?.label);
  const match = [...select.options].find(o => o.dataset.clean === targetName);
  if (match) select.value = match.value;
}

// ---- Render controls from settings -----------------------------------------

function renderControls(settings) {
  document.querySelectorAll(".switch[data-setting]").forEach(sw => {
    sw.setAttribute("aria-checked", String(Boolean(settings[sw.dataset.setting])));
  });
  document.querySelectorAll(".segmented[data-setting]").forEach(group => {
    const value = settings[group.dataset.setting];
    group.querySelectorAll(".segment").forEach(seg => {
      seg.classList.toggle("active", seg.dataset.value === value);
      seg.setAttribute("aria-pressed", String(seg.dataset.value === value));
    });
  });
  const model = document.getElementById("defaultModel");
  if (model) setModelValue(model, settings.defaultModel);
}

function wireControls() {
  document.querySelectorAll(".switch[data-setting]").forEach(sw => {
    sw.addEventListener("click", () => {
      const next = sw.getAttribute("aria-checked") !== "true";
      sw.setAttribute("aria-checked", String(next));
      updateSetting(sw.dataset.setting, next);
    });
  });
  document.querySelectorAll(".segmented[data-setting]").forEach(group => {
    group.querySelectorAll(".segment").forEach(seg => {
      seg.addEventListener("click", () => {
        group.querySelectorAll(".segment").forEach(s => {
          const active = s === seg;
          s.classList.toggle("active", active);
          s.setAttribute("aria-pressed", String(active));
        });
        updateSetting(group.dataset.setting, seg.dataset.value);
      });
    });
  });
  const model = document.getElementById("defaultModel");
  model?.addEventListener("change", () => updateSetting("defaultModel", model.value));
}

// ---- Connection status panel -----------------------------------------------

function maskOrganizationId(value) {
  const id = String(value || "");
  if (id.length <= 12) return "••••••••";
  return `${id.slice(0, 8)}…${id.slice(-4)}`;
}

function setAccountActionStatus(message) {
  const status = document.getElementById("account-action-status");
  if (status) status.textContent = message || "";
}

function formatAge(ms) {
  if (!ms) return "—";
  const seconds = Math.max(0, (Date.now() - ms) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.floor(hours / 24);
  if (days <= 31) return `${days} day${days === 1 ? "" : "s"} ago`;
  return "over a month ago";
}

function renderOrganizationId() {
  const orgEl = document.getElementById("detected-organization");
  const revealButton = document.getElementById("toggle-organization");
  const copyButton = document.getElementById("copy-organization");
  if (!orgEl || !revealButton || !copyButton) return;
  const has = Boolean(detectedOrganizationId);
  orgEl.textContent = has
    ? (organizationRevealed ? detectedOrganizationId : maskOrganizationId(detectedOrganizationId))
    : "Not detected yet";
  revealButton.disabled = !has;
  copyButton.disabled = !has;
  revealButton.textContent = organizationRevealed ? "Hide" : "Reveal";
}

async function renderDetectedAccount() {
  const capEl = document.getElementById("detected-cap");
  const ageEl = document.getElementById("cache-age");
  const badge = document.getElementById("connection-badge");
  if (!capEl) return;
  const detected = await CUCNative?.getCachedAccountConfig?.();
  const nextOrg = detected?.orgId || null;
  if (nextOrg !== detectedOrganizationId) organizationRevealed = false;
  detectedOrganizationId = nextOrg;
  renderOrganizationId();
  capEl.textContent = detected?.limitUsd > 0
    ? `${CUC.formatUsd(detected.limitUsd)} (${detected.currency || "USD"})`
    : "Not detected yet";
  if (ageEl) ageEl.textContent = detected?.cachedAt ? formatAge(detected.cachedAt) : "—";
  if (badge) {
    if (nextOrg) { badge.className = "badge badge-ok"; badge.textContent = "Connected"; }
    else { badge.className = "badge badge-muted"; badge.textContent = "Not detected yet"; }
  }
}

async function copyOrganizationId() {
  if (!detectedOrganizationId) return;
  try {
    await navigator.clipboard.writeText(detectedOrganizationId);
    setAccountActionStatus("Full organization ID copied.");
  } catch {
    setAccountActionStatus("Could not copy the organization ID.");
  }
}

function toggleOrganizationVisibility() {
  if (!detectedOrganizationId) return;
  organizationRevealed = !organizationRevealed;
  renderOrganizationId();
  setAccountActionStatus(organizationRevealed ? "Full organization ID revealed." : "Organization ID masked.");
}

// ---- Export / destructive reset --------------------------------------------

async function exportCsv() {
  const status = document.getElementById("export-status");
  try {
    const stored = await chrome.storage.local.get(["cuc:spend-days", "cuc:settings"]);
    const settings = CUC.mergeSettings(stored["cuc:settings"]);
    const granularity = settings.exportGranularity || "daily";
    const csv = CUC.spendCsv(stored["cuc:spend-days"], settings.defaultModel, granularity);
    const rowCount = Math.max(0, csv.split("\n").length - 1);
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `claude-usage-${CUC.todayKey()}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    status.textContent = rowCount === 0
      ? "No spend recorded yet — headers only."
      : `Exported ${rowCount} row${rowCount === 1 ? "" : "s"}.`;
  } catch (error) {
    status.textContent = `Export failed: ${error?.message || error}`;
  }
}

async function clearAllLocalData() {
  const confirmed = window.confirm(
    "Clear all Companion data stored in this browser? This removes settings, usage history, and caches. Claude itself is not changed."
  );
  if (!confirmed) return;

  const button = document.getElementById("clear-all-data");
  const status = document.getElementById("clear-data-status");
  button.disabled = true;
  status.textContent = "Clearing local data…";

  const results = await Promise.allSettled([
    chrome.storage.local.clear(),
    chrome.storage.session?.clear?.() || Promise.resolve(),
    chrome.action?.setBadgeText?.({ text: "" }) || Promise.resolve()
  ]);
  const failed = results.filter(r => r.status === "rejected");

  detectedOrganizationId = null;
  organizationRevealed = false;
  setAccountActionStatus("");
  await loadSettings();

  status.textContent = failed.length
    ? "Storage cleared, but one item couldn't be removed. Reopen Settings and try again."
    : "All local Companion data has been cleared.";
  button.disabled = false;
}

// ---- Section navigator -----------------------------------------------------

function wireSectionNav() {
  const links = [...document.querySelectorAll(".section-nav a")];
  const byId = new Map(links.map(a => [a.dataset.nav, a]));
  const setActive = id => {
    links.forEach(a => {
      const isActive = a.dataset.nav === id;
      a.classList.toggle("active", isActive);
      if (isActive) a.setAttribute("aria-current", "page");
      else a.removeAttribute("aria-current");
    });
  };
  const observer = new IntersectionObserver(entries => {
    // The section whose top is nearest the viewport top wins.
    const visible = entries.filter(e => e.isIntersecting)
      .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
    if (visible[0] && byId.has(visible[0].target.id)) setActive(visible[0].target.id);
  }, { rootMargin: "-70px 0px -55% 0px", threshold: 0 });
  document.querySelectorAll(".card[id]").forEach(section => observer.observe(section));
  // Clicking a link updates the highlight immediately (before scroll settles).
  links.forEach(a => a.addEventListener("click", () => setActive(a.dataset.nav)));
}

// ---- Load / defaults -------------------------------------------------------

async function loadSettings() {
  populateModels();
  const stored = await chrome.storage.local.get(["cuc:settings"]);
  const settings = CUC.mergeSettings(stored["cuc:settings"]);
  renderControls(settings);
  await renderDetectedAccount();
}

async function resetDefaults() {
  flashSaving();
  await chrome.storage.local.set({ "cuc:settings": CUC.DEFAULT_SETTINGS });
  await loadSettings();
  clearTimeout(saveStatusTimer);
  saveStatusTimer = setTimeout(flashSaved, 220);
}

// ---- Boot ------------------------------------------------------------------

document.getElementById("reset-defaults")?.addEventListener("click", resetDefaults);
document.getElementById("toggle-organization")?.addEventListener("click", toggleOrganizationVisibility);
document.getElementById("copy-organization")?.addEventListener("click", copyOrganizationId);
document.getElementById("clear-org-cache")?.addEventListener("click", async () => {
  if (CUCNative?.clearCachedOrgId) await CUCNative.clearCachedOrgId();
  detectedOrganizationId = null;
  organizationRevealed = false;
  await renderDetectedAccount();
  setAccountActionStatus("Cleared. Refresh a claude.ai tab to re-detect.");
});
document.getElementById("clear-all-data")?.addEventListener("click", clearAllLocalData);
document.getElementById("export-csv")?.addEventListener("click", exportCsv);

wireControls();
wireSectionNav();
loadSettings();
