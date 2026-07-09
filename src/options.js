const CUC = globalThis.ClaudeUsageCompanion;
const CUCNative = globalThis.ClaudeUsageCompanionNative;
const CUCUpdater = globalThis.ClaudeUsageCompanionUpdater;
const REPO_URL = "https://github.com/zgbrenner/claudecompanion";

// Settings simplified to the two visible bars: chat usage and enterprise limit.
const fields = [
  "displayMode",
  "defaultModel",
  "organizationId",
  "enterpriseMonthlyLimitUsd",
  "showNativeLimits",
  "desktopNotifications"
];

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
    applyButton.style.display = "none";
    return;
  }
  if (check.updateAvailable) {
    status.textContent = `Update available: v${check.latestVersion} (you have v${current}).${folderNote}`;
    applyButton.style.display = "inline-block";
    applyButton.textContent = `Install v${check.latestVersion}`;
  } else {
    status.textContent = `You're up to date (v${current}).`;
    applyButton.style.display = "none";
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
    applyUpdateButton().style.display = "none";
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
    const stored = await chrome.storage.local.get([CUC.makeStorageKey()]);
    const usage = CUC.normalizeUsage(stored[CUC.makeStorageKey()]);
    const csv = CUC.usageHistoryCsv(usage);
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
      ? "No usage recorded yet — the file has headers only."
      : `Exported ${rowCount} day${rowCount === 1 ? "" : "s"} of usage.`;
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

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Blank is a supported "auto-discover" mode, so this only flags values that
// are present but don't look like a UUID. Non-blocking: callers still save.
function organizationIdWarning(value) {
  const trimmed = String(value || "").trim();
  if (!trimmed) return null;
  if (UUID_PATTERN.test(trimmed)) return null;
  return "This doesn't look like a valid organization UUID. Saving anyway — leave blank to auto-discover instead.";
}

function renderOrganizationIdWarning(value) {
  const warningEl = document.getElementById("organizationId-warning");
  if (!warningEl) return;
  const message = organizationIdWarning(value);
  warningEl.textContent = message || "";
  warningEl.style.display = message ? "block" : "none";
}

async function saveSettings() {
  const settings = await readSettings();
  renderOrganizationIdWarning(settings.organizationId);
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

document.getElementById("organizationId")?.addEventListener("input", (event) => {
  renderOrganizationIdWarning(event.target.value);
});
document.getElementById("save").addEventListener("click", saveSettings);
document.getElementById("reset-defaults").addEventListener("click", resetDefaults);
document.getElementById("clear-org-cache")?.addEventListener("click", async () => {
  if (CUCNative?.clearCachedOrgId) await CUCNative.clearCachedOrgId();
  const status = document.getElementById("status");
  status.textContent = "Cleared. Refresh a claude.ai tab to re-detect.";
  setTimeout(() => { status.textContent = ""; }, 2400);
});
document.getElementById("export-csv")?.addEventListener("click", exportCsv);
document.getElementById("check-updates")?.addEventListener("click", checkForUpdates);
document.getElementById("setup-folder")?.addEventListener("click", setupUpdateFolder);
document.getElementById("apply-update")?.addEventListener("click", applyUpdateNow);
document.getElementById("open-github")?.addEventListener("click", () => openUrl(REPO_URL));
loadSettings();
checkForUpdates();
