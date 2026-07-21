(() => {
  const FRESH_MS = 5 * 60_000;
  const AGING_MS = 15 * 60_000;
  const EXPIRED_MS = 2 * 60 * 60_000;
  const MAX_FUTURE_SKEW_MS = 5 * 60_000;

  function ageLabel(ageMs) {
    if (ageMs < 60_000) return "just now";
    const minutes = Math.max(1, Math.round(ageMs / 60_000));
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.max(1, Math.round(minutes / 60));
    if (hours < 24) return `${hours}h ago`;
    return `${Math.max(1, Math.round(hours / 24))}d ago`;
  }

  function describe(observedAt, now = Date.now()) {
    if (!Number.isFinite(observedAt) || !Number.isFinite(now)) {
      return Object.freeze({ state: "missing", ageMs: null, label: "Not observed yet", showValues: false, warn: false });
    }
    if (observedAt > now + MAX_FUTURE_SKEW_MS) {
      return Object.freeze({ state: "expired", ageMs: 0, label: "Timestamp unavailable", showValues: false, warn: true });
    }

    const ageMs = Math.max(0, now - observedAt);
    const relative = ageLabel(ageMs);
    if (ageMs < FRESH_MS) {
      return Object.freeze({ state: "fresh", ageMs, label: `Updated ${relative}`, showValues: true, warn: false });
    }
    if (ageMs < AGING_MS) {
      return Object.freeze({ state: "aging", ageMs, label: `Updated ${relative}`, showValues: true, warn: false });
    }
    if (ageMs < EXPIRED_MS) {
      return Object.freeze({ state: "stale", ageMs, label: `Last observed ${relative}`, showValues: true, warn: true });
    }
    return Object.freeze({ state: "expired", ageMs, label: `Last observed ${relative}`, showValues: false, warn: true });
  }

  globalThis.CompanionOpenAIFreshness = Object.freeze({
    FRESH_MS,
    AGING_MS,
    EXPIRED_MS,
    describe,
  });
})();
