const CUC = globalThis.ClaudeUsageCompanion;
const CUCNative = globalThis.ClaudeUsageCompanionNative;

const BOOLEAN_SETTINGS = new Set([
  "showWidget",
  "showLifejacketMode",
  "lifejacketMode",
  "lifejacketPromptCompression",
  "lifejacketReplyBrevity",
  "lifejacketFileConversion",
  "showMonthlyCredits",
  "desktopNotifications",
  "showPlainEnglishTips",
  "showSessionSpend",
  "showWeekSpend",
  "showSessionLimit",
  "showWeeklyLimit",
  "showOpusLimit",
  "alwaysShowBadge",
]);
const LIFEJACKET_CHILD_SETTINGS = new Set([
  "lifejacketPromptCompression",
  "lifejacketReplyBrevity",
  "lifejacketFileConversion",
]);

let detectedOrganizationId = null;
let organizationRevealed = false;
let currentSettings = CUC.mergeSettings({});
let saveStatusTimer = null;

function flashSaved() {
  const element = document.getElementById("save-status");
  if (!element) return;
  element.classList.remove("saving");
  element.textContent = "All changes saved";
}

function flashSaving() {
  const element = document.getElementById("save-status");
  if (!element) return;
  element.classList.add("saving");
  element.textContent = "Saving…";
}

async function updateSetting(key, value) {
  flashSaving();
  try {
    const stored = await chrome.storage.local.get(["cuc:settings"]);
    const settings = CUC.mergeSettings({ ...(stored["cuc:settings"] || {}), [key]: value });
    await chrome.storage.local.set({ "cuc:settings": settings });
    currentSettings = settings;
    renderControls(settings);
    clearTimeout(saveStatusTimer);
    saveStatusTimer = setTimeout(flashSaved, 220);
  } catch {
    const element = document.getElementById("save-status");
    if (element) {
      element.classList.remove("saving");
      element.textContent = "Couldn't save. Try again.";
    }
  }
}

function cleanModelName(label) {
  return String(label || "").split(" — ")[0].trim();
}

function populateModels() {
  const select = document.getElementById("defaultModel");
  if (!select) return;
  select.innerHTML = "";
  const seen = new Set();
  for (const [key, model] of Object.entries(CUC.MODEL_PRICES)) {
    const name = cleanModelName(model.label);
    if (seen.has(name)) continue;
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
  if ([...select.options].some(option => option.value === wanted)) {
    select.value = wanted;
    return;
  }
  const targetName = cleanModelName(CUC.MODEL_PRICES[wanted]?.label || CUC.MODEL_PRICES[CUC.resolveModelKey(wanted)]?.label);
  const match = [...select.options].find(option => option.dataset.clean === targetName);
  if (match) select.value = match.value;
}

function renderControls(settings) {
  currentSettings = settings;
  document.querySelectorAll(".switch[data-setting]").forEach(control => {
    const key = control.dataset.setting;
    control.setAttribute("aria-checked", String(Boolean(settings[key])));
    const childDisabled = LIFEJACKET_CHILD_SETTINGS.has(key) && settings.lifejacketMode !== true;
    control.disabled = childDisabled;
    control.closest(".row")?.classList.toggle("setting-disabled", childDisabled);
  });
  document.querySelectorAll(".segmented[data-setting]").forEach(group => {
    const value = settings[group.dataset.setting];
    group.querySelectorAll(".segment").forEach(segment => {
      const active = segment.dataset.value === value;
      segment.classList.toggle("active", active);
      segment.setAttribute("aria-pressed", String(active));
    });
  });
  const model = document.getElementById("defaultModel");
  if (model) setModelValue(model, settings.defaultModel);
}

function wireControls() {
  document.querySelectorAll(".switch[data-setting]").forEach(control => {
    control.addEventListener("click", () => {
      if (control.disabled) return;
      const next = control.getAttribute("aria-checked") !== "true";
      control.setAttribute("aria-checked", String(next));
      const optimistic = CUC.mergeSettings({ ...currentSettings, [control.dataset.setting]: next });
      renderControls(optimistic);
      updateSetting(control.dataset.setting, next);
    });
  });
  document.querySelectorAll(".segmented[data-setting]").forEach(group => {
    group.querySelectorAll(".segment").forEach(segment => {
      segment.addEventListener("click", () => {
        group.querySelectorAll(".segment").forEach(candidate => {
          const active = candidate === segment;
          candidate.classList.toggle("active", active);
          candidate.setAttribute("aria-pressed", String(active));
        });
        updateSetting(group.dataset.setting, segment.dataset.value);
      });
    });
  });
  const model = document.getElementById("defaultModel");
  model?.addEventListener("change", () => updateSetting("defaultModel", model.value));
}

function maskOrganizationId(value) {
  const id = String(value || "");
  if (id.length <= 12) return "••••••••";
  return `${id.slice(0, 8)}…${id.slice(-4)}`;
}

function setAccountActionStatus(message) {
  const status = document.getElementById("account-action-status");
  if (status) status.textContent = message || "";
}

function formatAge(timestamp) {
  if (!timestamp) return "—";
  const seconds = Math.max(0, (Date.now() - timestamp) / 1000);
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
  const organization = document.getElementById("detected-organization");
  const reveal = document.getElementById("toggle-organization");
  const copy = document.getElementById("copy-organization");
  if (!organization || !reveal || !copy) return;
  const hasValue = Boolean(detectedOrganizationId);
  organization.textContent = hasValue
    ? (organizationRevealed ? detectedOrganizationId : maskOrganizationId(detectedOrganizationId))
    : "Not detected yet";
  reveal.disabled = !hasValue;
  copy.disabled = !hasValue;
  reveal.textContent = organizationRevealed ? "Hide" : "Reveal";
}

async function renderDetectedAccount() {
  const cap = document.getElementById("detected-cap");
  const age = document.getElementById("cache-age");
  const badge = document.getElementById("connection-badge");
  if (!cap) return;
  const detected = await CUCNative?.getCachedAccountConfig?.();
  const nextOrganization = detected?.orgId || null;
  if (nextOrganization !== detectedOrganizationId) organizationRevealed = false;
  detectedOrganizationId = nextOrganization;
  renderOrganizationId();
  cap.textContent = detected?.limitUsd > 0
    ? `${CUC.formatUsd(detected.limitUsd)} (${detected.currency || "USD"})`
    : "Not detected yet";
  if (age) age.textContent = detected?.cachedAt ? formatAge(detected.cachedAt) : "—";
  if (badge) {
    badge.className = nextOrganization ? "badge badge-ok" : "badge badge-muted";
    badge.textContent = nextOrganization ? "Connected" : "Not detected yet";
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
    const link = document.createElement("a");
    link.href = url;
    link.download = `claude-usage-${CUC.todayKey()}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    if (status) status.textContent = rowCount === 0
      ? "No spend recorded yet. Headers only."
      : `Exported ${rowCount} row${rowCount === 1 ? "" : "s"}.`;
  } catch (error) {
    if (status) status.textContent = `Export failed: ${error?.message || error}`;
  }
}

async function clearAllLocalData() {
  const confirmed = window.confirm(
    "Clear all COMPANION data stored in this browser? This removes settings, usage history, and caches. Provider accounts are not changed."
  );
  if (!confirmed) return;

  const button = document.getElementById("clear-all-data");
  const status = document.getElementById("clear-data-status");
  if (button) button.disabled = true;
  if (status) status.textContent = "Clearing local data…";
  const results = await Promise.allSettled([
    chrome.storage.local.clear(),
    chrome.storage.session?.clear?.() || Promise.resolve(),
    chrome.action?.setBadgeText?.({ text: "" }) || Promise.resolve(),
  ]);
  detectedOrganizationId = null;
  organizationRevealed = false;
  setAccountActionStatus("");
  await loadSettings();
  const failed = results.filter(result => result.status === "rejected");
  if (status) status.textContent = failed.length
    ? "Storage cleared, but one item could not be removed. Reopen Settings and try again."
    : "All local COMPANION data has been cleared.";
  if (button) button.disabled = false;
}

function wireSectionNav() {
  const links = [...document.querySelectorAll(".section-nav a")];
  const byId = new Map(links.map(link => [link.dataset.nav, link]));
  const setActive = id => {
    links.forEach(link => {
      const active = link.dataset.nav === id;
      link.classList.toggle("active", active);
      if (active) link.setAttribute("aria-current", "page");
      else link.removeAttribute("aria-current");
    });
  };
  const observer = new IntersectionObserver(entries => {
    const visible = entries
      .filter(entry => entry.isIntersecting)
      .sort((left, right) => left.boundingClientRect.top - right.boundingClientRect.top);
    if (visible[0] && byId.has(visible[0].target.id)) setActive(visible[0].target.id);
  }, { rootMargin: "-70px 0px -55% 0px", threshold: 0 });
  document.querySelectorAll(".card[id]").forEach(section => observer.observe(section));
  links.forEach(link => link.addEventListener("click", () => setActive(link.dataset.nav)));
}

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

void BOOLEAN_SETTINGS;
