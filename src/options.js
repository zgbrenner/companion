const CUC = globalThis.ClaudeUsageCompanion;
const CUCNative = globalThis.ClaudeUsageCompanionNative;
const CUCUpdater = globalThis.ClaudeUsageCompanionUpdater;
const REPO_URL = "https://github.com/zgbrenner/claudecompanion";
const UPDATER_DB_NAME = "cuc-updater";

// Settings simplified to the two visible bars: chat usage and enterprise limit.
const fields = [
  "displayMode",
  "defaultModel",
  "showNativeLimits",
  "desktopNotifications"
];

let detectedOrganizationId = null;
let organizationRevealed = false;

function populateModels() {
  const select = document.getElementById("defaultModel");
  select.innerHTML = "";
  Object.entries(CUC.MODEL_PRICES).forEach(([key, model]) => {
    const option = document.createElement("option");
    option.value = key;
    const expired = key === "claude-sonnet-5-intro" && CUC.resolveModelKey(key) !== key;
    const suffix = expired ? " (expired — using standard pricing)" : "";
    option.textContent = `${model.label} — $${model.inputPerMTok}/$${model.outputPerMTok} per MTok${suffix}`;
    select.appendChild(option);
  });
}

function maskOrganizationId(value) {
  const id = String(value || "");
  if (id.length <= 12) return "••••••••";
  return `${id.slice(0, 8)}…${id.slice(-4)}`;
}

function setAccountActionStatus(message) {
  const status = document.getElementById("account-action-status");
  if (!status) return;
  status.textContent = message || "";
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

async function renderDetectedAccount() {
  const capEl = document.getElementById("detected-cap");
  if (!capEl) return;
  const detected = await CUCNative?.getCachedAccountConfig?.();
  const nextOrganizationId = detected?.orgId || null;
  if (nextOrganizationId !== detectedOrganizationId) organizationRevealed = false;
  detectedOrganizationId = nextOrganizationId;
  renderOrganizationId();
  capEl.textContent = detected?.limitUsd > 0
    ? `${CUC.formatUsd(detected.limitUsd)} (${detected.currency || "USD"})`
    : "Not detected yet";
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

async function openUrl(url) {
  await chrome.tabs.create({ url });
}

// ---- Self-update UI (see updater.js for the mechanism) ---------------------

function updateStatusEl() { return document.getElementById("update-status"); }
function updateDetailEl() { return document.getElementById("update-detail"); }
function applyUpdateButton() { return document.getElementById("apply-update"); }

async function renderUpdateSection(check) {
  const status = updateStatusEl();
  const applyButton = applyUpdateButton();
  const current = CUCUpdater.currentVersion();
  const folder = await CUCUpdater.folderStatus().catch(() => "unset");
  const folderNote = folder === "unset"
    ? " One-click install needs the extension folder connected below."
    : (folder === "needs-permission" ? " Chrome will ask to confirm folder access when you install." : "");

  if (!check) {
    status.textContent = `Current version: ${current}.`;
    applyButton.hidden = true;
    return;
  }
  if (check.updateAvailable) {
    status.textContent = `Update available: v${check.latestVersion} (you have v${current}).${folderNote}`;
    applyButton.hidden = false;
    applyButton.textContent = `Install v${check.latestVersion}`;
  } else {
    status.textContent = `You're up to date (v${current}).`;
    applyButton.hidden = true;
  }
}

async function checkForUpdates() {
  const status = updateStatusEl();
  status.textContent = `Current version: ${CUCUpdater.currentVersion()}. Checking GitHub…`;
  try {
    const check = await CUCUpdater.checkForUpdate();
    await renderUpdateSection(check);
  } catch (error) {
    status.textContent = `Could not check for updates: ${error?.message || error}`;
    applyUpdateButton().hidden = true;
  }
}

async function setupUpdateFolder() {
  const detail = updateDetailEl();
  try {
    await CUCUpdater.chooseExtensionFolder();
    detail.textContent = "Extension folder connected — updates are now one click.";
    await renderUpdateSection(await CUCUpdater.checkForUpdate().catch(() => null));
  } catch (error) {
    if (error?.name === "AbortError") return; // user closed the picker
    detail.textContent = `Couldn't connect that folder: ${error?.message || error}`;
  }
}

async function applyUpdateNow() {
  const detail = updateDetailEl();
  const applyButton = applyUpdateButton();
  applyButton.disabled = true;
  try {
    const result = await CUCUpdater.applyUpdate(message => { detail.textContent = message; });
    detail.textContent = `Updated to v${result.version} — reloading the extension…`;
    // Give the message a beat to render; reload() tears this page down.
    setTimeout(() => chrome.runtime.reload(), 1200);
  } catch (error) {
    applyButton.disabled = false;
    if (error?.code === "no-folder") {
      detail.textContent = "First connect the extension folder (button below), then install.";
      return;
    }
    detail.textContent = `Update failed: ${error?.message || error}`;
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
      ? "No spend recorded yet — the file has headers only."
      : `Exported ${rowCount} day${rowCount === 1 ? "" : "s"} of real spend.`;
  } catch (error) {
    status.textContent = `Export failed: ${error?.message || error}`;
  }
}

async function loadSettings() {
  populateModels();
  const stored = await chrome.storage.local.get(["cuc:settings"]);
  const settings = { ...CUC.DEFAULT_SETTINGS, ...(stored["cuc:settings"] || {}) };

  for (const field of fields) {
    const el = document.getElementById(field);
    if (!el) continue;
    if (el.type === "checkbox") el.checked = Boolean(settings[field]);
    else el.value = settings[field];
  }
  await renderDetectedAccount();
}

async function readSettings() {
  const stored = await chrome.storage.local.get(["cuc:settings"]);
  // Merge onto the CURRENT stored settings, not DEFAULT_SETTINGS — otherwise
  // saving from this trimmed-down page would silently wipe fields that aren't
  // shown here.
  const settings = { ...CUC.DEFAULT_SETTINGS, ...(stored["cuc:settings"] || {}) };
  for (const field of fields) {
    const el = document.getElementById(field);
    if (!el) continue;
    if (el.type === "checkbox") settings[field] = el.checked;
    else if (el.type === "number") settings[field] = Number(el.value);
    else settings[field] = el.value;
  }
  return settings;
}

async function saveSettings() {
  const settings = await readSettings();
  await chrome.storage.local.set({ "cuc:settings": settings });
  const status = document.getElementById("status");
  status.textContent = "Saved";
  setTimeout(() => { status.textContent = ""; }, 1800);
}

async function resetDefaults() {
  await chrome.storage.local.set({ "cuc:settings": CUC.DEFAULT_SETTINGS });
  await loadSettings();
  const status = document.getElementById("status");
  status.textContent = "Defaults restored";
  setTimeout(() => { status.textContent = ""; }, 1800);
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
    "Clear all Claude Companion data stored in this browser? This removes settings, usage history, caches, and the connected update folder. Claude itself is not changed."
  );
  if (!confirmed) return;

  const button = document.getElementById("clear-all-data");
  const status = document.getElementById("clear-data-status");
  button.disabled = true;
  status.textContent = "Clearing local data…";

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
  updateDetailEl().textContent = "";
  await loadSettings();
  await renderUpdateSection(null);

  status.textContent = failed.length
    ? "Browser storage was cleared, but one local item could not be removed. Close and reopen Settings, then try again."
    : "All local Claude Companion data has been cleared.";
  button.disabled = false;
}

document.getElementById("save").addEventListener("click", saveSettings);
document.getElementById("reset-defaults").addEventListener("click", resetDefaults);
document.getElementById("toggle-organization")?.addEventListener("click", toggleOrganizationVisibility);
document.getElementById("copy-organization")?.addEventListener("click", copyOrganizationId);
document.getElementById("clear-org-cache")?.addEventListener("click", async () => {
  if (CUCNative?.clearCachedOrgId) await CUCNative.clearCachedOrgId();
  const status = document.getElementById("status");
  detectedOrganizationId = null;
  organizationRevealed = false;
  setAccountActionStatus("");
  await renderDetectedAccount();
  status.textContent = "Cleared. Refresh a claude.ai tab to re-detect.";
  setTimeout(() => { status.textContent = ""; }, 2400);
});
document.getElementById("clear-all-data")?.addEventListener("click", clearAllLocalData);
document.getElementById("export-csv")?.addEventListener("click", exportCsv);
document.getElementById("check-updates")?.addEventListener("click", checkForUpdates);
document.getElementById("setup-folder")?.addEventListener("click", setupUpdateFolder);
document.getElementById("apply-update")?.addEventListener("click", applyUpdateNow);
document.getElementById("open-github")?.addEventListener("click", () => openUrl(REPO_URL));
loadSettings();
checkForUpdates();
