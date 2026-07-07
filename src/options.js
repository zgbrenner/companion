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
      status.textContent = `Update available: ${latest.version} on ${latest.source}. Opening GitHub…`;
      await openUrl(latest.url);
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

document.getElementById("save").addEventListener("click", saveSettings);
document.getElementById("reset-defaults").addEventListener("click", resetDefaults);
document.getElementById("clear-org-cache")?.addEventListener("click", async () => {
  if (CUCNative?.clearCachedOrgId) await CUCNative.clearCachedOrgId();
  const status = document.getElementById("status");
  status.textContent = "Cleared. Refresh a claude.ai tab to re-detect.";
  setTimeout(() => { status.textContent = ""; }, 2400);
});
document.getElementById("check-updates")?.addEventListener("click", checkForUpdates);
document.getElementById("open-github")?.addEventListener("click", () => openUrl(REPO_URL));
loadSettings();
