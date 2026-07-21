// Isolated-world compatibility layer for the OpenAI page bridge.
//
// The one-time port transfer happens at document_start, before host-page scripts
// run. All later usage and generation messages travel through the private
// MessagePort rather than public DOM events. The legacy token-offer event is
// swallowed and used only inside the extension's isolated world.
(() => {
  if (globalThis.__COMPANION_OPENAI_CHANNEL_INSTALLED__) return;
  globalThis.__COMPANION_OPENAI_CHANNEL_INSTALLED__ = true;

  const LEGACY_USAGE_EVENT = "cuc:openai-usage-snapshot";
  const LEGACY_NETWORK_EVENT = "cuc:openai-network-event";
  const LEGACY_TOKEN_OFFER = "cuc:openai-token-offer";
  const PORT_OFFER = "cuc:openai-port-offer";
  const MAIN_READY = "cuc:openai-main-ready";

  const nativeAdd = window.addEventListener.bind(window);
  const nativeRemove = window.removeEventListener.bind(window);
  const nativeDispatch = window.dispatchEvent.bind(window);
  const nativePostMessage = window.postMessage.bind(window);
  const CustomEventCtor = globalThis.CustomEvent;

  let eventToken = null;
  let bridgePort = null;
  let acknowledged = false;
  let pendingOffer = false;
  const listeners = {
    usage: new Map(),
    network: new Map(),
  };

  function kindForLegacyName(type) {
    if (type === LEGACY_USAGE_EVENT) return "usage";
    if (type === LEGACY_NETWORK_EVENT) return "network";
    return null;
  }

  function validToken(value) {
    return typeof value === "string"
      && value.length >= 8
      && value.length <= 200
      && /^[A-Za-z0-9_-]+$/.test(value);
  }

  function invoke(listener, event) {
    if (typeof listener === "function") listener.call(window, event);
    else if (listener && typeof listener.handleEvent === "function") listener.handleEvent(event);
  }

  function deliver(kind, detail) {
    if (!eventToken || !detail || typeof detail !== "object" || Array.isArray(detail)) return;
    const type = kind === "usage" ? LEGACY_USAGE_EVENT : LEGACY_NETWORK_EVENT;
    const event = new CustomEventCtor(type, { detail: { ...detail, token: eventToken } });
    for (const listener of listeners[kind].keys()) invoke(listener, event);
  }

  function handlePortMessage(event) {
    const message = event?.data;
    if (!message || typeof message !== "object" || Array.isArray(message)) return;
    if (message.kind === "ready") {
      acknowledged = true;
      pendingOffer = false;
      return;
    }
    if ((message.kind === "usage" || message.kind === "network") && message.detail) {
      deliver(message.kind, message.detail);
    }
  }

  function offerPort() {
    if (!eventToken || acknowledged || pendingOffer) return;
    pendingOffer = true;
    try { bridgePort?.close?.(); } catch { /* best effort */ }
    const channel = new MessageChannel();
    bridgePort = channel.port1;
    bridgePort.addEventListener("message", handlePortMessage);
    bridgePort.start?.();
    try {
      nativePostMessage({ type: PORT_OFFER }, location.origin, [channel.port2]);
    } catch {
      pendingOffer = false;
      try { bridgePort.close(); } catch { /* best effort */ }
      bridgePort = null;
    }
  }

  nativeAdd("message", event => {
    if (event.source !== window || event.origin !== location.origin) return;
    if (event.data?.type !== MAIN_READY || acknowledged) return;
    pendingOffer = false;
    offerPort();
  });

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
    if (!eventToken) eventToken = offered;
    if (offered === eventToken) offerPort();
    return true;
  };
})();
