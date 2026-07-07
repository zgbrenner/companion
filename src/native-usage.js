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

  async function configuredEnterpriseLimitUsd() {
    const defaults = globalThis.ClaudeUsageCompanion?.DEFAULT_SETTINGS || {};
    try {
      const stored = await chrome.storage.local.get(["cuc:settings"]);
      const settings = { ...defaults, ...(stored["cuc:settings"] || {}) };
      return Number(settings.enterpriseMonthlyLimitUsd || 0);
    } catch {
      return Number(defaults.enterpriseMonthlyLimitUsd || 0);
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
    // Mirror fetchJson's status mapping so a 429/401/403 here surfaces the
    // same "rate-limited"/"not-logged-in" errors content.js already knows how
    // to handle (backoff, sign-in prompt), instead of a generic message that
    // content.js treats as an opaque "unavailable" failure.
    if (response.status === 401 || response.status === 403) {
      throw new Error("not-logged-in");
    }
    if (response.status === 429) {
      throw new Error("rate-limited");
    }
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
    const expectedLimit = await configuredEnterpriseLimitUsd();

    const capResult = applyCapAdvisory(normalized.monthlySpendLimit, expectedLimit);
    normalized.monthlySpendLimit = capResult.spendLimit;
    normalized.monthlySpendLimitRejected = capResult.rejected;

    // Prefer /usage.extra_usage, which reflects the member-visible usage-credit
    // card. /overage_spend_limit can be the organization-wide cap (for example
    // $5000) and must not replace a per-employee cap like $100.
    if (!normalized.monthlySpendLimit) {
      const fallback = await fetchMonthlySpendLimit(orgId, expectedLimit);
      if (fallback.spendLimit) {
        normalized.monthlySpendLimit = fallback.spendLimit;
        normalized.monthlySpendLimitRejected = null;
      } else if (fallback.rejected) {
        normalized.monthlySpendLimitRejected = fallback.rejected;
      }
    }

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
    if (response.status === 429) {
      throw new Error("rate-limited");
    }
    if (!response.ok) {
      throw new Error(`request failed: ${response.status}`);
    }
    return response.json();
  }

  // Compares a normalized spend-limit reading against the admin-configured
  // expected cap. Three outcomes:
  //   - matches (or no expectation configured): pass through unchanged.
  //   - close in value but different (a genuine cap change, e.g. admin bumped
  //     the per-employee limit): keep showing the real data, but attach a
  //     capAdvisory so the UI can note the mismatch instead of hiding it.
  //   - off by ~100x (classic cents-vs-dollars unit drift): the number would
  //     be wildly misleading if displayed, so reject it outright.
  function applyCapAdvisory(spendLimit, expectedLimitUsd) {
    if (!spendLimit) return { spendLimit: null, rejected: null };
    if (!(expectedLimitUsd > 0)) return { spendLimit, rejected: null };

    const diff = Math.abs(spendLimit.limitUsd - expectedLimitUsd);
    if (diff <= 0.01) return { spendLimit, rejected: null };

    if (isLikelyUnitDrift(spendLimit.limitUsd, expectedLimitUsd)) {
      return {
        spendLimit: null,
        rejected: {
          foundLimitUsd: spendLimit.limitUsd,
          expectedLimitUsd,
          reason: "unit-drift"
        }
      };
    }

    return {
      spendLimit: {
        ...spendLimit,
        capAdvisory: { foundLimitUsd: spendLimit.limitUsd, expectedLimitUsd }
      },
      rejected: null
    };
  }

  // Heuristic: a returned limit that is ~100x (or ~1/100x) the expected cap
  // looks like a cents/dollars unit mismatch rather than a genuine cap
  // change, so it gets rejected rather than displayed as an "advisory".
  // Tolerance is +/-20% around the 100x ratio to allow for rounding.
  function isLikelyUnitDrift(foundLimitUsd, expectedLimitUsd) {
    if (!(foundLimitUsd > 0) || !(expectedLimitUsd > 0)) return false;
    const ratio = foundLimitUsd / expectedLimitUsd;
    const within = (target) => ratio > target * 0.8 && ratio < target * 1.2;
    return within(100) || within(0.01);
  }

  async function fetchMonthlySpendLimit(orgId, expectedLimitUsd) {
    try {
      const payload = await fetchJson(`https://claude.ai/api/organizations/${orgId}/overage_spend_limit`);
      const normalized = normalizeMonthlySpendLimit(payload);
      if (!normalized) return { spendLimit: null, rejected: null };
      return applyCapAdvisory(normalized, expectedLimitUsd);
    } catch (error) {
      const message = String(error?.message || error);
      if (message === "not-logged-in" || message === "rate-limited") throw error;
      return { spendLimit: null, rejected: null };
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
      // /usage.extra_usage carries no reset timestamp. The cap replenishes
      // monthly, so fall back to "first of next month UTC" as an approximate
      // reset date rather than showing nothing.
      resetsAt: nextMonthFirstDayUtcIso(),
      resetsAtApprox: true
    });
  }

  function normalizeMonthlySpendLimit(payload) {
    if (!payload || typeof payload !== "object") return null;
    if (payload.used_credits == null || payload.monthly_credit_limit == null) return null;
    const disabledUntil = payload.disabled_until || null;
    return normalizeSpendLimitValues({
      isEnabled: payload.is_enabled,
      usedCents: payload.used_credits,
      limitCents: payload.monthly_credit_limit,
      currency: payload.currency,
      outOfCredits: payload.out_of_credits,
      disabledReason: payload.disabled_reason,
      // Prefer the endpoint's own reset timestamp when present; only fall
      // back to the approximate monthly-rollover date when it's missing.
      resetsAt: disabledUntil || nextMonthFirstDayUtcIso(),
      resetsAtApprox: !disabledUntil
    });
  }

  function normalizeSpendLimitValues({ isEnabled, usedCents, limitCents, currency, outOfCredits, disabledReason, resetsAt, resetsAtApprox }) {
    const usedUsd = Number(usedCents) / 100;
    const limitUsd = Number(limitCents) / 100;
    if (!Number.isFinite(usedUsd) || !Number.isFinite(limitUsd) || limitUsd <= 0) return null;
    return {
      isEnabled: Boolean(isEnabled),
      usedUsd,
      limitUsd,
      source: "claude",
      currency: typeof currency === "string" ? currency : "USD",
      utilizationPct: (usedUsd / limitUsd) * 100,
      resetsAt,
      resetsAtApprox: Boolean(resetsAtApprox),
      outOfCredits: Boolean(outOfCredits),
      disabledReason: typeof disabledReason === "string" ? disabledReason : null
    };
  }

  // First day of next month, 00:00 UTC, as an ISO string. Used as a client-side
  // approximation of the monthly cap reset when the API doesn't provide one.
  function nextMonthFirstDayUtcIso(now = new Date()) {
    const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1, 0, 0, 0));
    return next.toISOString();
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

  // Renders a reset hint for a normalized spend-limit object: an exact
  // countdown when the source gave us a real timestamp, or a visibly
  // approximate "~<Month> <day>" label when we fell back to the client-side
  // monthly-rollover guess.
  function formatResetLabel(spendLimit) {
    if (!spendLimit?.resetsAt) return null;
    if (spendLimit.resetsAtApprox) {
      const date = new Date(spendLimit.resetsAt);
      if (Number.isNaN(date.getTime())) return null;
      const month = date.toLocaleString("en-US", { month: "short", timeZone: "UTC" });
      const day = date.getUTCDate();
      return `resets ~${month} ${day}`;
    }
    const countdown = formatResetCountdown(spendLimit.resetsAt);
    return countdown ? `resets in ${countdown}` : null;
  }

  globalThis.ClaudeUsageCompanionNative = {
    fetchNativeUsage,
    clearCachedOrgId,
    formatResetCountdown,
    formatResetLabel,
    // Exposed for unit testing pure helpers; not used elsewhere in the extension.
    _internal: { isLikelyUnitDrift, applyCapAdvisory, nextMonthFirstDayUtcIso }
  };
})();
