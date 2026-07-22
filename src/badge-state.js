(() => {
  const STATE_KEY = "cuc:badge-state";
  const ALARM_PREFIX = "cuc:badge-expiry:openai:";
  const ALLOWED_PROVIDERS = new Set(["claude", "openai"]);
  let chain = Promise.resolve();

  // Capture Chrome's real badge methods before the provider adapters load.
  // The service-worker entry point imports this module first. Replacing the
  // public methods below makes later legacy direct writes harmless, while this
  // owner keeps the only references that can reach the native API.
  const nativeSetBadgeText = chrome.action.setBadgeText.bind(chrome.action);
  const nativeSetBadgeBackgroundColor = chrome.action.setBadgeBackgroundColor.bind(chrome.action);
  const blockedDirectWrite = async () => undefined;
  try {
    Object.defineProperties(chrome.action, {
      setBadgeText: { value: blockedDirectWrite, configurable: false, writable: false },
      setBadgeBackgroundColor: { value: blockedDirectWrite, configurable: false, writable: false },
    });
  } catch {
    // Chrome's extension API objects are currently configurable. This fallback
    // preserves compatibility with test doubles or older Chromium variants.
    try { chrome.action.setBadgeText = blockedDirectWrite; } catch { /* best effort */ }
    try { chrome.action.setBadgeBackgroundColor = blockedDirectWrite; } catch { /* best effort */ }
  }

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

  async function createAlarm(name, when) {
    if (!name || !Number.isFinite(when) || !chrome.alarms?.create) return false;
    try {
      await chrome.alarms.create(name, { when });
      return true;
    } catch {
      return false;
    }
  }

  function validInput(provider, observedAt) {
    return ALLOWED_PROVIDERS.has(provider)
      && Number.isFinite(observedAt)
      && observedAt >= 0;
  }

  async function clearOwnedState(current = null) {
    if (current?.alarmName) await clearAlarm(current.alarmName);
    await nativeSetBadgeText({ text: "" });
    await removeState();
  }

  async function reconcileStartup(now = Date.now()) {
    const current = await getState();
    if (!current) {
      // The browser may retain toolbar paint after storage.session is cleared.
      await nativeSetBadgeText({ text: "" });
      return { status: "cleared-orphan" };
    }

    if (!validInput(current.provider, current.observedAt)) {
      await clearOwnedState(current);
      return { status: "cleared-invalid" };
    }

    if (current.provider === "claude") {
      return { status: "preserved-claude" };
    }

    if (!Number.isFinite(current.expiresAt) || current.expiresAt <= now) {
      await clearOwnedState(current);
      return { status: "cleared-expired" };
    }

    const alarmName = `${ALARM_PREFIX}${current.observedAt}`;
    if (current.alarmName && current.alarmName !== alarmName) {
      await clearAlarm(current.alarmName);
    }
    const scheduled = await createAlarm(alarmName, current.expiresAt);
    const next = { ...current, alarmName: scheduled ? alarmName : null };
    if (next.alarmName !== current.alarmName) await setState(next);
    return { status: scheduled ? "rescheduled-openai" : "preserved-openai" };
  }

  async function setBadge({ provider, observedAt, text = "", color = null, expiresAt = null } = {}) {
    if (!validInput(provider, observedAt)) return false;
    return serialize(async () => {
      const prior = await getState();
      if (prior?.alarmName) await clearAlarm(prior.alarmName);

      const safeText = typeof text === "string" ? text.slice(0, 8) : "";
      await nativeSetBadgeText({ text: safeText });
      if (safeText && typeof color === "string" && color) {
        await nativeSetBadgeBackgroundColor({ color });
      }

      if (!safeText) {
        await removeState();
        return true;
      }

      const safeExpiresAt = provider === "openai" && Number.isFinite(expiresAt) && expiresAt > observedAt
        ? expiresAt
        : null;
      let alarmName = null;
      if (safeExpiresAt != null) {
        const wanted = `${ALARM_PREFIX}${observedAt}`;
        if (await createAlarm(wanted, safeExpiresAt)) alarmName = wanted;
      }

      await setState({ provider, observedAt, expiresAt: safeExpiresAt, alarmName });
      return true;
    });
  }

  async function clearIfCurrent(provider, observedAt) {
    if (!validInput(provider, observedAt)) return false;
    return serialize(async () => {
      const current = await getState();
      if (!current || current.provider !== provider || current.observedAt !== observedAt) return false;
      await clearOwnedState(current);
      return true;
    });
  }

  chrome.alarms?.onAlarm?.addListener(alarm => {
    const name = String(alarm?.name || "");
    if (!name.startsWith(ALARM_PREFIX)) return undefined;
    const observedAt = Number(name.slice(ALARM_PREFIX.length));
    if (!Number.isFinite(observedAt)) return undefined;
    return clearIfCurrent("openai", observedAt).catch(() => false);
  });

  const ready = serialize(() => reconcileStartup());

  globalThis.CompanionBadgeState = Object.freeze({
    STATE_KEY,
    ALARM_PREFIX,
    ready,
    set: setBadge,
    clearIfCurrent,
    reconcile: now => serialize(() => reconcileStartup(now)),
  });
})();
