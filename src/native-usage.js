// Native usage: reads Claude.ai's own internal usage endpoint instead of
// estimating from local heuristics. This is ground truth, not an estimate.
//
// Endpoints (undocumented, may change without notice):
//   GET https://claude.ai/api/organizations                -> org list, cached 24h
//   GET https://claude.ai/api/organizations/{orgId}/usage   -> { five_hour, seven_day, seven_day_opus }
//
// The browser attaches the session cookie automatically because these requests
// originate from a content script running on a claude.ai page with host
// permission for claude.ai. This code never reads or stores the cookie itself.
//
// Response shape (as observed by prior open-source extensions targeting this
// endpoint; not officially documented by Anthropic, so shape may drift):
//   { five_hour: { utilization: <0-100>, resets_at: <ISO8601> },
//     seven_day: { utilization: <0-100>, resets_at: <ISO8601> },
//     seven_day_opus: { utilization: <0-100>, resets_at: <ISO8601> } }
(() => {
  const CACHE_KEY = "cuc:native-org-cache";
  const ORG_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

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
    const response = await fetch(`https://claude.ai/api/organizations/${orgId}/usage`, {
      method: "GET",
      credentials: "include"
    });
    if (response.status === 401 || response.status === 403) {
      throw new Error("not-logged-in");
    }
    if (!response.ok) {
      throw new Error(`usage request failed: ${response.status}`);
    }
    const payload = await response.json();
    return normalizeUsagePayload(payload);
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
      sevenDayOpus: pick("seven_day_opus")
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
