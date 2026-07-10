const CUC = globalThis.ClaudeUsageCompanion;
const CUCNative = globalThis.ClaudeUsageCompanionNative;
const CUCUpdater = globalThis.ClaudeUsageCompanionUpdater;
const REPO_URL = "https://github.com/zgbrenner/claudecompanion";
const UPDATER_DB_NAME = "cuc-updater";
const SETTING_FIELDS = ["displayMode", "defaultModel", "showNativeLimits", "desktopNotifications"];

let detectedOrganizationId = null;
let organizationRevealed = false;
let saveStatusTimer = null;
let isLoadingSettings = false;

function populateModels() {
  const select = document.getElementById("defaultModel");
  select.innerHTML = "";
  Object.entries(CUC.MODEL_PRICES).forEach(([key, model]) => {
    const option = document.createElement("option");
    option.value = key;
    const expired = key === "claude-sonnet-5-intro" && CUC.resolveModelKey(key) !== key;
    const suffix = expired ? " (standard pricing now applies)" : "";
    option.textContent = `${model.label}${suffix}`;
    select.appendChild(option);
  });
}

function setSaveStatus(message, { persistent = false, error = false } = {}) {
  const status = document.getElementById("status");
  const dot = document.querySelector(".saved-dot");
  if (!status) return;
  clearTimeout(saveStatusTimer);
  status.textContent = message;
  if (dot) dot.style.color = error ? "var(--danger)" : "var(--primary)";
  if (!persistent) {
    saveStatusTimer = setTimeout(() => {
      status.textContent = "Changes save automatically";
      if (dot) dot.style.color = "var(--primary)";
    }, 1800);
  }
}

function maskOrganizationId(value) {
  const id = String(value || "");
  if (id.length <= 12) return "••••••••";
  return `${id.slice(0, 8)}…${id.slice(-4)}`;
}

function formatCacheAge(cachedAt) {
  const timestamp = Number(cachedAt);
  if (!Number.isFinite(timestamp) || timestamp <= 0) return "Cached for up to 48 hours";
  const elapsedMinutes = Math.max(0, Math.round((Date.now() - timestamp) / 60000));
  if (elapsedMinutes < 2) return "Detected just now";
  if (elapsedMinutes < 60) return `Detected ${elapsedMinutes} minutes ago`;
  const elapsedHours = Math.round(elapsedMinutes / 60);
  if (elapsedHours === 1) return "Detected about an hour ago";
  return `Detected about ${elapsedHours} hours ago`;
}

function setAccountActionStatus(message, isError = false) {
  const status = document.getElementById("account-action-status");
  if (!status) return;
  status.textContent = message || "";
  status.classList.toggle("feedback-danger", Boolean(isError));
}

function renderOrganizationId() {
  const orgEl = document.getElementById("detected-organization");
  const revealButton = document.getElementById("toggle-organization");
  const copyButton = document.getElementById("copy-organization");
  if (!orgEl || !revealButton || !copyButton) return;

  const hasOrganization = Boolean(detectedOrganizationId);
  orgEl.textContent = hasOrganization
    ? (organizationRevealed ? detectedOrganizationId : maskOrganizationId(detectedOrganizationId))
    : "Not detected yet";
  revealButton.disabled = !hasOrganization;
  copyButton.disabled = !hasOrganization;
  revealButton.textContent = organizationRevealed ? "Hide" : "Reveal";
}

function renderConnectionStatus(isConnected) {
  const badge = document.getElementById("connection-status");
  if (!badge) return;
  badge.classList.toggle("badge-success", isConnected);
  badge.innerHTML = `<span class="status-dot"></span>${isConnected ? "Connected" : "Waiting for Claude"}`;
}

async function renderDetectedAccount() {
  const capEl = document.getElementById("detected-cap");
  const cacheAgeEl = document.getElementById("cache-age");
  if (!capEl || !cacheAgeEl) return;

  const detected = await CUCNative?.getCachedAccountConfig?.();
  const nextOrganizationId = detected?.orgId || null;
  if (nextOrganizationId !== detectedOrganizationId) organizationRevealed = false;
  detectedOrganizationId = nextOrganizationId;
  renderOrganizationId();
  renderConnectionStatus(Boolean(detectedOrganizationId));

  capEl.textContent = detected?.limitUsd > 0
    ? `${CUC.formatUsd(detected.limitUsd)} ${detected.currency || "USD"}`
    : "Not detected yet";
  cacheAgeEl.textContent = detectedOrganizationId
    ? formatCacheAge(detected?.cachedAt)
    : "Open Claude.ai to detect your account";
}

async function copyOrganizationId() {
  if (!detectedOrganizationId) return;
  try {
    await navigator.clipboard.writeText(detectedOrganizationId);
    setAccountActionStatus("Organization ID copied.");
  } catch {
    setAccountActionStatus("Could not copy the organization ID.", true);
  }
}

function toggleOrganizationVisibility() {
  if (!detectedOrganizationId) return;
  organizationRevealed = !organizationRevealed;
  renderOrganizationId();
  setAccountActionStatus(organizationRevealed ? "Full organization ID revealed." : "Organization ID masked.");
}

async function openUrl(url) {
  await chrome.tabs.create({ url });
}

function updateStatusEl() { return document.getElementById("update-status"); }
function updateDetailEl() { return document.getElementById("update-detail"); }
function applyUpdateButton() { return document.getElementById("apply-update"); }

async function renderUpdateSection(check) {
  const status = updateStatusEl();
  const detail = updateDetailEl();
  const applyButton = applyUpdateButton();
  const current = CUCUpdater.currentVersion();
  const folder = await CUCUpdater.folderStatus().catch(() => "unset");
  document.getElementById("version-badge").textContent = `v${current}`;

  if (!check) {
    status.textContent = `Version ${current}`;
    detail.textContent = folder === "ready"
      ? "One-click updates are enabled on this device."
      : "Check for a newer version or enable one-click installation.";
    applyButton.hidden = true;
    return;
  }

  if (check.updateAvailable) {
    status.textContent = `Version ${check.latestVersion} is available`;
    detail.textContent = folder === "ready"
      ? `You currently have version ${current}. The update is ready to install.`
      : `You currently have version ${current}. Enable one-click updates before installing.`;
    applyButton.hidden = false;
    applyButton.textContent = `Install v${check.latestVersion}`;
  } else {
    status.textContent = "Claude Companion is up to date";
    detail.textContent = `Version ${current} is installed${folder === "ready" ? ", and one-click updates are enabled." : "."}`;
    applyButton.hidden = true;
  }
}

async function checkForUpdates() {
  updateStatusEl().textContent = "Checking for updates…";
  updateDetailEl().textContent = "Contacting the project repository.";
  try {
    const check = await CUCUpdater.checkForUpdate();
    await renderUpdateSection(check);
  } catch (error) {
    updateStatusEl().textContent = "Could not check for updates";
    updateDetailEl().textContent = error?.message || String(error);
    applyUpdateButton().hidden = true;
  }
}

async function setupUpdateFolder() {
  const detail = updateDetailEl();
  try {
    await CUCUpdater.chooseExtensionFolder();
    detail.textContent = "One-click updates are enabled on this device.";
    await renderUpdateSection(await CUCUpdater.checkForUpdate().catch(() => null));
  } catch (error) {
    if (error?.name === "AbortError") return;
    detail.textContent = `Could not enable one-click updates: ${error?.message || error}`;
  }
}

async function applyUpdateNow() {
  const detail = updateDetailEl();
  const applyButton = applyUpdateButton();
  applyButton.disabled = true;
  try {
    const result = await CUCUpdater.applyUpdate(message => { detail.textContent = message; });
    detail.textContent = `Updated to v${result.version}. Reloading Claude Companion…`;
    setTimeout(() => chrome.runtime.reload(), 1200);
  } catch (error) {
    applyButton.disabled = false;
    detail.textContent = error?.code === "no-folder"
      ? "Enable one-click updates first, then install the update."
      : `Update failed: ${error?.message || error}`;
  }
}

async function exportCsv() {
  const status = document.getElementById("export-status");
  try {
    const stored = await chrome.storage.local.get(["cuc:spend-days", "cuc:settings"]);
    const settings = { ...CUC.DEFAULT_SETTINGS, ...(stored["cuc:settings"] || {}) };
    const csv = CUC.spendDaysCsv(stored["cuc:spend-days"], settings.defaultModel);
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
      ? "Downloaded a blank template because no spend has been recorded yet."
      : `Downloaded ${rowCount} day${rowCount === 1 ? "" : "s"} of usage history.`;
  } catch (error) {
    status.textContent = `Export failed: ${error?.message || error}`;
    status.classList.add("feedback-danger");
  }
}

function setFieldValue(field, value) {
  if (field === "displayMode") {
    const radio = document.querySelector(`input[name="displayMode"][value="${CSS.escape(String(value))}"]`);
    if (radio) radio.checked = true;
    return;
  }
  const element = document.getElementById(field);
  if (!element) return;
  if (element.type === "checkbox") element.checked = Boolean(value);
  else element.value = value;
}

function getFieldValue(field) {
  if (field === "displayMode") {
    return document.querySelector('input[name="displayMode"]:checked')?.value || CUC.DEFAULT_SETTINGS.displayMode;
  }
  const element = document.getElementById(field);
  if (!element) return undefined;
  if (element.type === "checkbox") return element.checked;
  if (element.type === "number") return Number(element.value);
  return element.value;
}

async function loadSettings() {
  isLoadingSettings = true;
  populateModels();
  const stored = await chrome.storage.local.get(["cuc:settings"]);
  const settings = { ...CUC.DEFAULT_SETTINGS, ...(stored["cuc:settings"] || {}) };
  for (const field of SETTING_FIELDS) setFieldValue(field, settings[field]);
  await renderDetectedAccount();
  isLoadingSettings = false;
}

async function readSettings() {
  const stored = await chrome.storage.local.get(["cuc:settings"]);
  const settings = { ...CUC.DEFAULT_SETTINGS, ...(stored["cuc:settings"] || {}) };
  for (const field of SETTING_FIELDS) {
    const value = getFieldValue(field);
    if (value !== undefined) settings[field] = value;
  }
  return settings;
}

async function saveSettings() {
  if (isLoadingSettings) return;
  setSaveStatus("Saving…", { persistent: true });
  try {
    const settings = await readSettings();
    await chrome.storage.local.set({ "cuc:settings": settings });
    setSaveStatus("Saved");
  } catch {
    setSaveStatus("Could not save changes", { persistent: true, error: true });
  }
}

async function resetDefaults() {
  await chrome.storage.local.set({ "cuc:settings": CUC.DEFAULT_SETTINGS });
  await loadSettings();
  setSaveStatus("Defaults restored");
}

function deleteUpdaterDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(UPDATER_DB_NAME);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error || new Error("Could not clear updater database."));
    request.onblocked = () => reject(new Error("Updater database is still in use. Close and reopen Settings, then try again."));
  });
}

async function clearAllLocalData() {
  const confirmed = window.confirm(
    "Clear all Claude Companion data stored in this browser? Your Claude account and conversations will not be changed."
  );
  if (!confirmed) return;

  const button = document.getElementById("clear-all-data");
  const status = document.getElementById("clear-data-status");
  button.disabled = true;
  status.textContent = "Clearing local data…";
  status.classList.remove("feedback-danger");

  const operations = [
    chrome.storage.local.clear(),
    chrome.storage.session?.clear?.() || Promise.resolve(),
    deleteUpdaterDatabase(),
    chrome.action?.setBadgeText?.({ text: "" }) || Promise.resolve()
  ];
  const results = await Promise.allSettled(operations);
  const failed = results.filter(result => result.status === "rejected");

  detectedOrganizationId = null;
  organizationRevealed = false;
  setAccountActionStatus("");
  await loadSettings();
  await renderUpdateSection(null);

  status.textContent = failed.length
    ? "Most local data was cleared, but one browser item could not be removed. Close and reopen Settings, then try again."
    : "All Claude Companion data stored in this browser has been cleared.";
  status.classList.toggle("feedback-danger", failed.length > 0);
  button.disabled = false;
}

function observeActiveSection() {
  const links = [...document.querySelectorAll(".section-nav a")];
  const sections = links
    .map(link => document.querySelector(link.getAttribute("href")))
    .filter(Boolean);
  if (!sections.length || !("IntersectionObserver" in window)) return;

  const observer = new IntersectionObserver(entries => {
    const visible = entries
      .filter(entry => entry.isIntersecting)
      .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
    if (!visible) return;
    for (const link of links) {
      link.classList.toggle("active", link.getAttribute("href") === `#${visible.target.id}`);
    }
  }, { rootMargin: "-20% 0px -65% 0px", threshold: [0.05, 0.25, 0.5] });

  for (const section of sections) observer.observe(section);
}

for (const radio of document.querySelectorAll('input[name="displayMode"]')) {
  radio.addEventListener("change", saveSettings);
}
for (const field of ["defaultModel", "showNativeLimits", "desktopNotifications"]) {
  document.getElementById(field)?.addEventListener("change", saveSettings);
}

document.getElementById("reset-defaults")?.addEventListener("click", resetDefaults);
document.getElementById("toggle-organization")?.addEventListener("click", toggleOrganizationVisibility);
document.getElementById("copy-organization")?.addEventListener("click", copyOrganizationId);
document.getElementById("clear-org-cache")?.addEventListener("click", async () => {
  if (CUCNative?.clearCachedOrgId) await CUCNative.clearCachedOrgId();
  detectedOrganizationId = null;
  organizationRevealed = false;
  setAccountActionStatus("");
  await renderDetectedAccount();
  setAccountActionStatus("Detected account forgotten. Open or refresh Claude.ai to detect it again.");
});
document.getElementById("clear-all-data")?.addEventListener("click", clearAllLocalData);
document.getElementById("export-csv")?.addEventListener("click", exportCsv);
document.getElementById("check-updates")?.addEventListener("click", checkForUpdates);
document.getElementById("setup-folder")?.addEventListener("click", setupUpdateFolder);
document.getElementById("apply-update")?.addEventListener("click", applyUpdateNow);
document.getElementById("open-github")?.addEventListener("click", () => openUrl(REPO_URL));

observeActiveSection();
loadSettings().then(() => setSaveStatus("Changes save automatically", { persistent: true }));
checkForUpdates();
