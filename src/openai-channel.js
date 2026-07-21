// Isolated-world compatibility layer for the OpenAI page bridge.
//
// At document_start, this script publishes a one-time random channel identifier
// in a temporary DOM mailbox. The MAIN-world observer removes that mailbox as
// soon as it reads it, before host-page scripts run. Later communication uses
// unguessable event names and JSON-string payloads. The legacy token-offer event
// is swallowed and never reaches the page world.
(() => {
  if (globalThis.__COMPANION_OPENAI_CHANNEL_INSTALLED__) return;
  globalThis.__COMPANION_OPENAI_CHANNEL_INSTALLED__ = true;

  const LEGACY_USAGE_EVENT = "cuc:openai-usage-snapshot";
  const LEGACY_NETWORK_EVENT = "cuc:openai-network-event";
  const LEGACY_TOKEN_OFFER = "cuc:openai-token-offer";
  const MAILBOX_ID = "cuc-openai-channel-mailbox";
  const STATE_ATTRIBUTE = "data-companion-openai-bridge";

  const nativeAdd = window.addEventListener.bind(window);
  const nativeRemove = window.removeEventListener.bind(window);
  const nativeDispatch = window.dispatchEvent.bind(window);
  const CustomEventCtor = globalThis.CustomEvent;

  let eventToken = null;
  let listenersInstalled = false;
  const listeners = {
    usage: new Map(),
    network: new Map(),
  };
  const secretHandlers = {};

  function markState(value) {
    try { document.documentElement?.setAttribute(STATE_ATTRIBUTE, value); }
    catch { /* diagnostics must never affect the page */ }
  }

  function validToken(value) {
    return typeof value === "string"
      && value.length >= 8
      && value.length <= 200
      && /^[A-Za-z0-9_-]+$/.test(value);
  }

  function kindForLegacyName(type) {
    if (type === LEGACY_USAGE_EVENT) return "usage";
    if (type === LEGACY_NETWORK_EVENT) return "network";
    return null;
  }

  function secretName(kind) {
    return `cuc:openai-${kind}:${eventToken}`;
  }

  function parsePayload(value) {
    if (typeof value !== "string" || value.length > 2_100_000) return null;
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }

  function invoke(listener, event) {
    if (typeof listener === "function") listener.call(window, event);
    else if (listener && typeof listener.handleEvent === "function") listener.handleEvent(event);
  }

  function deliver(kind, payload) {
    if (!eventToken || !payload) return;
    const type = kind === "usage" ? LEGACY_USAGE_EVENT : LEGACY_NETWORK_EVENT;
    const event = new CustomEventCtor(type, { detail: { ...payload, token: eventToken } });
    for (const listener of listeners[kind].keys()) invoke(listener, event);
    markState(kind);
  }

  function installSecretListeners() {
    if (!eventToken || listenersInstalled) return;
    listenersInstalled = true;
    for (const kind of ["usage", "network"]) {
      const handler = event => {
        const payload = parsePayload(event?.detail);
        if (payload) deliver(kind, payload);
      };
      secretHandlers[kind] = handler;
      nativeAdd(secretName(kind), handler);
    }
  }

  function publishMailbox() {
    if (!eventToken || !document.documentElement) return false;
    const prior = document.getElementById(MAILBOX_ID);
    if (prior) return true;
    const mailbox = document.createElement("meta");
    mailbox.id = MAILBOX_ID;
    mailbox.setAttribute("data-channel", eventToken);
    mailbox.hidden = true;
    document.documentElement.appendChild(mailbox);
    markState("mailbox");
    return true;
  }

  window.addEventListener = function companionChannelAdd(type, listener, options) {
    const kind = kindForLegacyName(type);
    if (!kind) return nativeAdd(type, listener, options);
    if (listener) listeners[kind].set(listener, options);
    return undefined;
  };

  window.removeEventListener = function companionChannelRemove(type, listener, options) {
    const kind = kindForLegacyName(type);
    if (!kind) return nativeRemove(type, listener, options);
    listeners[kind].delete(listener);
    return undefined;
  };

  window.dispatchEvent = function companionChannelDispatch(event) {
    if (event?.type !== LEGACY_TOKEN_OFFER) return nativeDispatch(event);
    const offered = event?.detail?.token;
    if (!validToken(offered)) return true;
    if (!eventToken) {
      eventToken = offered;
      installSecretListeners();
      if (!publishMailbox()) {
        document.addEventListener("DOMContentLoaded", publishMailbox, { once: true });
      }
    }
    return true;
  };
})();
