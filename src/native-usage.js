// Native usage: reads Claude.ai's own internal usage endpoint instead of
// estimating from local heuristics. This is ground truth, not an estimate.
//
// Endpoints (undocumented, may change without notice):
//   GET https://claude.ai/api/organizations                -> org list, cached 24h
//   GET https://claude.ai/api/organizations/{orgId}/usage   -> { five_hour, seven_day, seven_day_opus }
//   GET https://claude.ai/api/organizations/{orgId}/overage_spend_limit
//                                                        -> monthly usage-credit spend/limit
//
// The browser attaches the session cookie automatically because these requests
// originate from a content script running on a claude.ai page with host
// permission for claude.ai. This code never reads or stores the cookie itself.
//
// /usage response shape (as observed by prior open-source extensions targeting
// this endpoint; not officially documented by Anthropic, so shape may drift):
//   { five_hour: { utilization: <0-100>, resets_at: <ISO8601> },
//     seven_day: { utilization: <0-100>, resets_at: <ISO8601> },
//     seven_day_opus: { utilization: <0-100>, resets_at: <ISO8601> },
//     extra_usage: { used_credits, monthly_limit, currency, ... } }
//
// /overage_spend_limit response shape:
//   { is_enabled, monthly_credit_limit, used_credits, currency,
//     out_of_credits, disabled_reason, disabled_until, ... }
(() => {
  const CACHE_KEY = "cuc:native-org-cache";
  const ORG_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

  async function configuredOrgId() {
    const defaults = globalThis.ClaudeUsageCompanion?.DEFAULT_SETTINGS || {};
    try {
      const stored = await chrome.storage.local.get(["cuc:settings"]);
      const settings = { ...defaults, ...(stored["cuc:settings"] || {}) };
      return String(settings.organizationId || "").trim();
    } catch {
      return String(defaults.organizationId || "").trim();
    }
  }

  async function getCachedOrgId() {
    try {
      const stored = await chrome.storage.local.get([CACHE_KEY]);
      const cache = stored[CACHE_KEY];
      if (!cache) return null;
      if (Date.now() - (cache.cachedAt || 0) > ORG_CACHE_TTL_MS) return null;
      return cache.orgId || null;
    } catch {
      return null;
    }
  }

  async function setCachedOrgId(orgId) {
    try {
      await chrome.storage.local.set({
        [CACHE_KEY]: { orgId, cachedAt: Date.now() }
      });
    } catch {
      // best-effort; a failed cache write just means we re-fetch next time
    }
  }

  async function clearCachedOrgId() {
    try {
      await chrome.storage.local.remove([CACHE_KEY]);
    } catch {
      // ignore
    }
  }

  async function discoverOrgId() {
    const configured = await configuredOrgId();
    if (configured) return configured;

    const cached = await getCachedOrgId();
    if (cached) return cached;

    const response = await fetch("https://claude.ai/api/organizations", {
      method: "GET",
      credentials: "include"
    });
    if (!response.ok) {
      throw new Error(`organizations request failed: ${response.status}`);
    }
    const orgs = await response.json();
    // If there are multiple orgs (team/enterprise accounts), we take the
    // first one. That can be the wrong org for some accounts — there is no
    // reliable browser-side signal for "currently active org" beyond this,
    // so this is a best-effort default rather than a guarantee.
    const orgId = Array.isArray(orgs) ? orgs[0]?.uuid : orgs?.[0]?.uuid;
    if (!orgId) throw new Error("no organization id found in response");

    await setCachedOrgId(orgId);
    return orgId;
  }

  async function fetchNativeUsage() {
    const orgId = await discoverOrgId();
    const usagePayload = await fetchJson(`https://claude.ai/api/organizations/${orgId}/usage`);
    const normalized = normalizeUsagePayload(usagePayload);
    normalized.monthlySpendLimit = await fetchMonthlySpendLimit(orgId, normalized.monthlySpendLimit);

    // A 200 with none of the expected buckets means the endpoint shape drifted
    // (this endpoint is undocumented and can change without notice). Surface it
    // as an error so the UI shows "unavailable" instead of a silently blank
    // section that looks like everything is fine.
    if (!normalized.fiveHour && !normalized.sevenDay && !normalized.sevenDayOpus && !normalized.monthlySpendLimit) {
      throw new Error("unexpected-usage-shape");
    }
    return normalized;
  }

  async function fetchJson(url) {
    const response = await fetch(url, {
      method: "GET",
      credentials: "include"
    });
    if (response.status === 401 || response.status === 403) {
      throw new Error("not-logged-in");
    }
    if (!response.ok) {
      throw new Error(`request failed: ${response.status}`);
    }
    return response.json();
  }

  async function fetchMonthlySpendLimit(orgId, fallback = null) {
    try {
      const payload = await fetchJson(`https://claude.ai/api/organizations/${orgId}/overage_spend_limit`);
      return normalizeMonthlySpendLimit(payload);
    } catch (error) {
      if (String(error?.message || error) === "not-logged-in") throw error;
      return fallback;
    }
  }

  // Normalize into a stable internal shape so the rest of the extension
  // doesn't depend on the endpoint's exact field names if they change.
  function normalizeUsagePayload(payload) {
    const pick = (key) => {
      const bucket = payload?.[key];
      if (!bucket || typeof bucket.utilization !== "number") return null;
      return {
        utilizationPct: bucket.utilization,
        resetsAt: bucket.resets_at || null
      };
    };
    return {
      fetchedAt: Date.now(),
      fiveHour: pick("five_hour"),
      sevenDay: pick("seven_day"),
      sevenDayOpus: pick("seven_day_opus"),
      monthlySpendLimit: normalizeExtraUsage(payload?.extra_usage)
    };
  }

  function normalizeExtraUsage(extraUsage) {
    if (!extraUsage || typeof extraUsage !== "object") return null;
    if (extraUsage.used_credits == null || extraUsage.monthly_limit == null) return null;
    return normalizeSpendLimitValues({
      isEnabled: extraUsage.is_enabled,
      usedCents: extraUsage.used_credits,
      limitCents: extraUsage.monthly_limit,
      currency: extraUsage.currency,
      outOfCredits: Number(extraUsage.used_credits) >= Number(extraUsage.monthly_limit),
      disabledReason: extraUsage.disabled_reason,
      resetsAt: null
    });
  }

  function normalizeMonthlySpendLimit(payload) {
    if (!payload || typeof payload !== "object") return null;
    if (payload.used_credits == null || payload.monthly_credit_limit == null) return null;
    return normalizeSpendLimitValues({
      isEnabled: payload.is_enabled,
      usedCents: payload.used_credits,
      limitCents: payload.monthly_credit_limit,
      currency: payload.currency,
      outOfCredits: payload.out_of_credits,
      disabledReason: payload.disabled_reason,
      resetsAt: payload.disabled_until || null
    });
  }

  function normalizeSpendLimitValues({ isEnabled, usedCents, limitCents, currency, outOfCredits, disabledReason, resetsAt }) {
    const usedUsd = Number(usedCents) / 100;
    const limitUsd = Number(limitCents) / 100;
    if (!Number.isFinite(usedUsd) || !Number.isFinite(limitUsd) || limitUsd <= 0) return null;
    return {
      isEnabled: Boolean(isEnabled),
      usedUsd,
      limitUsd,
      currency: typeof currency === "string" ? currency : "USD",
      utilizationPct: (usedUsd / limitUsd) * 100,
      resetsAt,
      outOfCredits: Boolean(outOfCredits),
      disabledReason: typeof disabledReason === "string" ? disabledReason : null
    };
  }

  function formatResetCountdown(isoTimestamp) {
    if (!isoTimestamp) return null;
    const resetMs = Date.parse(isoTimestamp);
    if (Number.isNaN(resetMs)) return null;
    const diffMs = resetMs - Date.now();
    if (diffMs <= 0) return "resetting";

    const totalMinutes = Math.round(diffMs / 60000);
    if (totalMinutes < 60) return `${totalMinutes}m`;
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    if (hours < 24) return `${hours}h ${minutes}m`;
    const days = Math.floor(hours / 24);
    const remHours = hours % 24;
    return `${days}d ${remHours}h`;
  }

  globalThis.ClaudeUsageCompanionNative = {
    fetchNativeUsage,
    clearCachedOrgId,
    formatResetCountdown
  };
})();
