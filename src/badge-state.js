(() => {
  const STATE_KEY = "cuc:badge-state";
  const ALARM_PREFIX = "cuc:badge-expiry:openai:";
  const ALLOWED_PROVIDERS = new Set(["claude", "openai"]);
  let chain = Promise.resolve();

  function serialize(task) {
    const run = chain.then(task, task);
    chain = run.catch(() => {});
    return run;
  }

  async function getState() {
    try {
      const stored = await chrome.storage.session.get([STATE_KEY]);
      return stored[STATE_KEY] || null;
    } catch {
      const stored = await chrome.storage.local.get([STATE_KEY]);
      return stored[STATE_KEY] || null;
    }
  }

  async function setState(value) {
    try {
      await chrome.storage.session.set({ [STATE_KEY]: value });
    } catch {
      await chrome.storage.local.set({ [STATE_KEY]: value });
    }
  }

  async function removeState() {
    try {
      await chrome.storage.session.remove([STATE_KEY]);
    } catch {
      await chrome.storage.local.remove([STATE_KEY]);
    }
  }

  async function clearAlarm(name) {
    if (!name || !chrome.alarms?.clear) return;
    try { await chrome.alarms.clear(name); }
    catch { /* alarm cleanup is best effort */ }
  }

  function validInput(provider, observedAt) {
    return ALLOWED_PROVIDERS.has(provider)
      && Number.isFinite(observedAt)
      && observedAt >= 0;
  }

  async function setBadge({ provider, observedAt, text = "", color = null, expiresAt = null } = {}) {
    if (!validInput(provider, observedAt)) return false;
    return serialize(async () => {
      const prior = await getState();
      if (prior?.alarmName) await clearAlarm(prior.alarmName);

      const safeText = typeof text === "string" ? text.slice(0, 8) : "";
      await chrome.action.setBadgeText({ text: safeText });
      if (safeText && typeof color === "string" && color) {
        await chrome.action.setBadgeBackgroundColor({ color });
      }

      if (!safeText) {
        await removeState();
        return true;
      }

      let alarmName = null;
      if (provider === "openai" && Number.isFinite(expiresAt) && expiresAt > observedAt && chrome.alarms?.create) {
        alarmName = `${ALARM_PREFIX}${observedAt}`;
        try { await chrome.alarms.create(alarmName, { when: expiresAt }); }
        catch { alarmName = null; }
      }

      await setState({ provider, observedAt, alarmName });
      return true;
    });
  }

  async function clearIfCurrent(provider, observedAt) {
    if (!validInput(provider, observedAt)) return false;
    return serialize(async () => {
      const current = await getState();
      if (!current || current.provider !== provider || current.observedAt !== observedAt) return false;
      if (current.alarmName) await clearAlarm(current.alarmName);
      await chrome.action.setBadgeText({ text: "" });
      await removeState();
      return true;
    });
  }

  chrome.alarms?.onAlarm?.addListener(alarm => {
    const name = String(alarm?.name || "");
    if (!name.startsWith(ALARM_PREFIX)) return;
    const observedAt = Number(name.slice(ALARM_PREFIX.length));
    if (!Number.isFinite(observedAt)) return;
    clearIfCurrent("openai", observedAt).catch(() => {});
  });

  globalThis.CompanionBadgeState = Object.freeze({
    STATE_KEY,
    ALARM_PREFIX,
    set: setBadge,
    clearIfCurrent,
  });
})();
