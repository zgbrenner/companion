const CUC = globalThis.ClaudeUsageCompanion;
const CUCNative = globalThis.ClaudeUsageCompanionNative;
const REPO_URL = "https://github.com/zgbrenner/claudecompanion";
const LATEST_RELEASE_API = "https://api.github.com/repos/zgbrenner/claudecompanion/releases/latest";
const MAIN_MANIFEST_URL = "https://raw.githubusercontent.com/zgbrenner/claudecompanion/main/manifest.json";

// Settings simplified to the two visible bars: chat usage and enterprise limit.
const fields = [
  "displayMode",
  "defaultModel",
  "organizationId",
  "enterpriseMonthlyLimitUsd",
  "showNativeLimits"
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

function currentVersion() {
  return chrome.runtime.getManifest().version;
}

function compareVersions(a, b) {
  const left = String(a || "0").split(".").map(part => Number.parseInt(part, 10) || 0);
  const right = String(b || "0").split(".").map(part => Number.parseInt(part, 10) || 0);
  const length = Math.max(left.length, right.length);
  for (let i = 0; i < length; i += 1) {
    const diff = (left[i] || 0) - (right[i] || 0);
    if (diff !== 0) return diff > 0 ? 1 : -1;
  }
  return 0;
}

function cleanVersionTag(value) {
  return String(value || "").trim().replace(/^v/i, "");
}

async function fetchJson(url) {
  const response = await fetch(url, { headers: { Accept: "application/json" } });
  if (!response.ok) throw new Error(`request failed: ${response.status}`);
  return response.json();
}

async function latestGithubVersion() {
  try {
    const release = await fetchJson(LATEST_RELEASE_API);
    const version = cleanVersionTag(release.tag_name || release.name);
    if (version) {
      return {
        source: "latest release",
        version,
        url: release.html_url || `${REPO_URL}/releases`
      };
    }
  } catch {
    // Repos without releases return 404; fall through to main.
  }

  const manifest = await fetchJson(MAIN_MANIFEST_URL);
  return {
    source: "main branch",
    version: cleanVersionTag(manifest.version),
    url: REPO_URL
  };
}

async function openUrl(url) {
  await chrome.tabs.create({ url });
}

async function checkForUpdates() {
  const status = document.getElementById("update-status");
  const current = currentVersion();
  status.textContent = `Current version: ${current}. Checking GitHub…`;

  try {
    const latest = await latestGithubVersion();
    const comparison = compareVersions(current, latest.version);
    if (comparison < 0) {
      // Show a link rather than yanking the user to GitHub unannounced —
      // startling for someone who has never seen GitHub.
      status.textContent = `Update available: ${latest.version} on ${latest.source}. `;
      const link = document.createElement("a");
      link.href = latest.url;
      link.target = "_blank";
      link.rel = "noreferrer noopener";
      link.textContent = "View on GitHub";
      status.appendChild(link);
      return;
    }
    if (comparison > 0) {
      status.textContent = `Current version ${current} is newer than ${latest.source} (${latest.version}).`;
      return;
    }
    status.textContent = `Current version ${current} matches ${latest.source}.`;
  } catch (error) {
    status.textContent = `Could not check GitHub updates: ${error?.message || error}`;
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
document.getElementById("open-github")?.addEventListener("click", () => openUrl(REPO_URL));
loadSettings();
