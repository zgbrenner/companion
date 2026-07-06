const CUC = globalThis.ClaudeUsageCompanion;
const CUCNative = globalThis.ClaudeUsageCompanionNative;

// Settings simplified to what people actually need day-to-day. budgetMode is
// no longer user-selectable — the widget always shows daily budget, since
// that's the framing that matches how people actually think about a budget.
const fields = [
  "displayMode",
  "defaultModel",
  "dailyBudgetUsd",
  "showNativeLimits",
  "showOpusLimit"
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
  // saving from this trimmed-down page would silently wipe fields that
  // aren't shown here (widget position, collapsed state, budgetMode).
  const settings = { ...CUC.DEFAULT_SETTINGS, ...(stored["cuc:settings"] || {}) };
  for (const field of fields) {
    const el = document.getElementById(field);
    if (!el) continue;
    if (el.type === "checkbox") settings[field] = el.checked;
    else if (el.type === "number") settings[field] = Number(el.value);
    else settings[field] = el.value;
  }
  settings.priceBasisLabel = "API-equivalent estimate";
  settings.budgetMode = "daily";
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
document.getElementById("reset-widget-position")?.addEventListener("click", async () => {
  const stored = await chrome.storage.local.get(["cuc:settings"]);
  const settings = { ...CUC.DEFAULT_SETTINGS, ...(stored["cuc:settings"] || {}) };
  settings.widgetPosition = null;
  settings.widgetAnchorMode = "docked";
  await chrome.storage.local.set({ "cuc:settings": settings });
  const status = document.getElementById("status");
  status.textContent = "Widget will snap back under the chat box.";
  setTimeout(() => { status.textContent = ""; }, 2400);
});
loadSettings();
