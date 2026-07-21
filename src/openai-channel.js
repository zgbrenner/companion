// Isolated-world compatibility layer for the OpenAI page bridge.
//
// openai-content.js originally listened on fixed DOM event names and expected a
// token inside each event payload. Repeating that token let a later page script
// observe it and forge future usage events. This layer keeps the proven content
// integration unchanged while translating it onto random per-page event names.
// The legacy token-offer event is swallowed before it reaches the page world.
(() => {
  if (globalThis.__COMPANION_OPENAI_CHANNEL_INSTALLED__) return;
  globalThis.__COMPANION_OPENAI_CHANNEL_INSTALLED__ = true;

  const LEGACY_USAGE_EVENT = "cuc:openai-usage-snapshot";
  const LEGACY_NETWORK_EVENT = "cuc:openai-network-event";
  const LEGACY_TOKEN_OFFER = "cuc:openai-token-offer";
  const CHANNEL_OFFER = "cuc:openai-channel-offer";
  const CHANNEL_READY = "cuc:openai-channel-ready";

  const nativeAdd = window.addEventListener.bind(window);
  const nativeRemove = window.removeEventListener.bind(window);
  const nativeDispatch = window.dispatchEvent.bind(window);
  const CustomEventCtor = globalThis.CustomEvent;

  let channelId = null;
  let acknowledged = false;
  const pending = {
    usage: [],
    network: [],
  };
  const wrappers = {
    usage: new Map(),
    network: new Map(),
  };

  function validChannelId(value) {
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
    return `cuc:openai-${kind}:${channelId}`;
  }

  function invoke(listener, event) {
    if (typeof listener === "function") {
      listener.call(window, event);
    } else if (listener && typeof listener.handleEvent === "function") {
      listener.handleEvent(event);
    }
  }

  function installListener(kind, listener, options) {
    if (!listener || !channelId) return;
    const prior = wrappers[kind].get(listener);
    if (prior) nativeRemove(secretName(kind), prior, options);
    const wrapped = event => {
      const legacyEvent = new CustomEventCtor(
        kind === "usage" ? LEGACY_USAGE_EVENT : LEGACY_NETWORK_EVENT,
        { detail: { ...(event?.detail || {}), token: channelId } },
      );
      invoke(listener, legacyEvent);
    };
    wrappers[kind].set(listener, wrapped);
    nativeAdd(secretName(kind), wrapped, options);
  }

  function installPending() {
    for (const kind of ["usage", "network"]) {
      const entries = pending[kind].splice(0);
      for (const entry of entries) installListener(kind, entry.listener, entry.options);
    }
  }

  function offerChannel() {
    if (!channelId || acknowledged) return;
    nativeDispatch(new CustomEventCtor(CHANNEL_OFFER, { detail: { channelId } }));
  }

  nativeAdd(CHANNEL_READY, () => {
    acknowledged = true;
  });

  window.addEventListener = function companionChannelAdd(type, listener, options) {
    const kind = kindForLegacyName(type);
    if (!kind) return nativeAdd(type, listener, options);
    if (!channelId) {
      pending[kind].push({ listener, options });
      return undefined;
    }
    installListener(kind, listener, options);
    return undefined;
  };

  window.removeEventListener = function companionChannelRemove(type, listener, options) {
    const kind = kindForLegacyName(type);
    if (!kind) return nativeRemove(type, listener, options);
    pending[kind] = pending[kind].filter(entry => entry.listener !== listener);
    const wrapped = wrappers[kind].get(listener);
    if (wrapped && channelId) nativeRemove(secretName(kind), wrapped, options);
    wrappers[kind].delete(listener);
    return undefined;
  };

  window.dispatchEvent = function companionChannelDispatch(event) {
    if (event?.type !== LEGACY_TOKEN_OFFER) return nativeDispatch(event);
    const offered = event?.detail?.token;
    if (!validChannelId(offered)) return true;
    if (!channelId) {
      channelId = offered;
      installPending();
    }
    if (offered === channelId) offerChannel();
    return true;
  };
})();
