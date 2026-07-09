// Native usage: reads Claude.ai's own internal usage endpoint instead of
// estimating from local heuristics. This is ground truth, not an estimate.
//
// Endpoints (undocumented, may change without notice):
//   GET https://claude.ai/api/organizations                -> org list, cached 48h
//   GET https://claude.ai/api/organizations/{orgId}/usage   -> { five_hour, seven_day, seven_day_opus }
//   GET https://claude.ai/api/organizations/{orgId}/overage_spend_limit
//                                                        -> monthly usage-credit spend/limit
//
// The browser attaches the authenticated Claude session automatically because
// these requests originate from a content script on claude.ai. The extension
// reads only the non-authentication `lastActiveOrg` organization identifier;
// it never reads, stores, or transmits the authentication/session cookie.
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
  const ACCOUNT_CACHE_KEY = "cuc:detected-account-cache";
  const CACHE_TTL_MS = 48 * 60 * 60 * 1000;
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  function cacheIsFresh(cache) {
    const cachedAt = Number(cache?.cachedAt);
    return Number.isFinite(cachedAt) && cachedAt > 0 && Date.now() - cachedAt <= CACHE_TTL_MS;
  }

  async function getCachedOrgId() {
    try {
      const stored = await chrome.storage.local.get([CACHE_KEY]);
      const cache = stored[CACHE_KEY];
      if (!cache) return null;
      if (!cacheIsFresh(cache) || !UUID_RE.test(String(cache.orgId || ""))) {
        await chrome.storage.local.remove([CACHE_KEY]);
        return null;
      }
      return cache.orgId;
    } catch {
      return null;
    }
  }

  async function setCachedOrgId(orgId) {
    if (!UUID_RE.test(String(orgId || ""))) return;
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
      await chrome.storage.local.remove([CACHE_KEY, ACCOUNT_CACHE_KEY]);
    } catch {
      // ignore
    }
  }

  async function cacheDetectedAccount(orgId, spendLimit) {
    if (!UUID_RE.test(String(orgId || ""))) return;
    const limitUsd = Number(spendLimit?.limitUsd);
    if (!(limitUsd > 0)) return;
    try {
      await chrome.storage.local.set({
        [ACCOUNT_CACHE_KEY]: {
          orgId,
          limitUsd,
          currency: typeof spendLimit.currency === "string" ? spendLimit.currency : "USD",
          cachedAt: Date.now()
        }
      });
    } catch {
      // The live Claude response remains the source of truth; caching is best-effort.
    }
  }

  async function getCachedAccountConfig() {
    try {
      const stored = await chrome.storage.local.get([CACHE_KEY, ACCOUNT_CACHE_KEY]);
      const org = stored[CACHE_KEY] || null;
      const account = stored[ACCOUNT_CACHE_KEY] || null;
      const orgFresh = cacheIsFresh(org) && UUID_RE.test(String(org?.orgId || ""));
      const accountFresh = cacheIsFresh(account) && UUID_RE.test(String(account?.orgId || ""));
      const staleKeys = [];
      if (org && !orgFresh) staleKeys.push(CACHE_KEY);
      if (account && !accountFresh) staleKeys.push(ACCOUNT_CACHE_KEY);
      if (staleKeys.length) await chrome.storage.local.remove(staleKeys);

      const orgId = orgFresh ? org.orgId : (accountFresh ? account.orgId : null);
      const capMatchesOrganization = accountFresh && account.orgId === orgId;
      const limitUsd = Number(account?.limitUsd);
      return {
        orgId,
        limitUsd: capMatchesOrganization && Number.isFinite(limitUsd) && limitUsd > 0 ? limitUsd : null,
        currency: capMatchesOrganization && typeof account.currency === "string" ? account.currency : "USD",
        cachedAt: capMatchesOrganization ? account.cachedAt : (orgFresh ? org.cachedAt : null)
      };
    } catch {
      return { orgId: null, limitUsd: null, currency: "USD", cachedAt: null };
    }
  }

  // claude.ai stores the organization the user is actively working in inside
  // the `lastActiveOrg` cookie (readable here because this runs in a content
  // script on a claude.ai page). This is the most reliable "which org am I
  // actually using" signal available browser-side — the /api/organizations
  // list order is not — and the same approach is used by other actively
  // maintained open-source claude.ai extensions. Only the organization UUID is
  // cached locally for 48 hours; it is never sent anywhere other than Claude's
  // own usage endpoints.
  function orgIdFromCookie() {
    try {
      const match = document.cookie.match(/(?:^|;\s*)lastActiveOrg=([^;]+)/);
      const value = match ? decodeURIComponent(match[1]).trim() : "";
      return UUID_RE.test(value) ? value : null;
    } catch {
      return null;
    }
  }

  async function discoverOrgId() {
    const fromCookie = orgIdFromCookie();
    if (fromCookie) {
      await setCachedOrgId(fromCookie);
      return fromCookie;
    }

    const cached = await getCachedOrgId();
    if (cached) return cached;

    const response = await fetch("https://claude.ai/api/organizations", {
      method: "GET",
      credentials: "include"
    });
    // Mirror fetchJson's status mapping so a 429/401/403 here surfaces the
    // same errors content.js already knows how to handle (backoff, sign-in
    // prompt, wrong-org note), instead of a generic message that content.js
    // treats as an opaque "unavailable" failure.
    if (response.status === 401) {
      throw new Error("not-logged-in");
    }
    if (response.status === 403) {
      throw new Error("forbidden");
    }
    if (response.status === 429) {
      throw new Error("rate-limited");
    }
    if (!response.ok) {
      throw new Error(`organizations request failed: ${response.status}`);
    }
    const orgs = await response.json();
    // If there are multiple orgs (team/enterprise accounts), we take the
    // first one. That can be the wrong org for some accounts — the
    // lastActiveOrg cookie above is checked first precisely because this
    // list order is a best-effort default rather than a guarantee.
    const orgId = Array.isArray(orgs) ? orgs[0]?.uuid : orgs?.[0]?.uuid;
    if (!orgId) throw new Error("no organization id found in response");

    await setCachedOrgId(orgId);
    return orgId;
  }

  async function fetchNativeUsage() {
    let orgId = await discoverOrgId();
    let usagePayload;
    try {
      usagePayload = await fetchJson(`https://claude.ai/api/organizations/${orgId}/usage`);
    } catch (error) {
      // A 403 usually means the cached/detected organization no longer matches
      // the signed-in account (for example, after switching accounts) — not that
      // the user is signed out. Clear local detection state and retry once from
      // the live cookie or organization list before giving up.
      if (String(error?.message) !== "forbidden") throw error;
      await clearCachedOrgId();
      const rediscovered = await discoverOrgId();
      if (!rediscovered || rediscovered === orgId) throw error;
      usagePayload = await fetchJson(`https://claude.ai/api/organizations/${rediscovered}/usage`);
      orgId = rediscovered;
    }
    const normalized = normalizeUsagePayload(usagePayload);

    // Prefer /usage.extra_usage, which reflects the member-visible usage-credit
    // card. Fall back to /overage_spend_limit only when the usage response does
    // not include a cap. No organization or cap value is configured locally.
    if (!normalized.monthlySpendLimit) {
      normalized.monthlySpendLimit = await fetchMonthlySpendLimit(orgId);
    }
    if (normalized.monthlySpendLimit) {
      await cacheDetectedAccount(orgId, normalized.monthlySpendLimit);
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
    if (response.status === 401) {
      throw new Error("not-logged-in");
    }
    // Keep 403 distinct from 401 so callers can clear detection state and retry
    // instead of sending the user through an unnecessary sign-in loop.
    if (response.status === 403) {
      throw new Error("forbidden");
    }
    if (response.status === 429) {
      throw new Error("rate-limited");
    }
    if (!response.ok) {
      throw new Error(`request failed: ${response.status}`);
    }
    return response.json();
  }

  async function fetchMonthlySpendLimit(orgId) {
    try {
      const payload = await fetchJson(`https://claude.ai/api/organizations/${orgId}/overage_spend_limit`);
      return normalizeMonthlySpendLimit(payload);
    } catch (error) {
      const message = String(error?.message || error);
      // This endpoint is optional and can be admin-restricted. Preserve the
      // rolling-limit data already fetched from /usage when it is unavailable.
      if (message === "not-logged-in" || message === "rate-limited") throw error;
      return null;
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

  // ---- Per-model daily spend breakdown (learned endpoint) ------------------
  //
  // Claude.ai's Settings → Usage page shows an individual per-day, per-model
  // spend breakdown, but its backing endpoint is undocumented and — as of
  // this writing — not publicly reverse-engineered (the feature only rolls
  // out broadly on 2026-07-11). So instead of hardcoding a guess, the
  // MAIN-world watcher reports the PATH of any usage/spend-looking API call
  // claude.ai itself makes (e.g. when the user opens Settings → Usage), we
  // remember it, and re-read it ourselves with a credentialed same-origin
  // GET. The payload is normalized defensively and accepted only when it
  // both parses into per-model dollar rows AND passes a sanity check against
  // the real monthly counter.

  const SPEND_ENDPOINT_KEY = "cuc:spend-endpoint";

  function isCandidateSpendPath(path) {
    if (typeof path !== "string" || !path.startsWith("/api/") || path.length > 300) return false;
    if (/overage_spend_limit/i.test(path)) return false;
    // The plain /usage endpoint is already polled directly.
    if (/\/usage$/i.test(path)) return false;
    return /usage|spend|billing|credit|cost|analytic|consumption|breakdown/i.test(path);
  }

  async function rememberSpendEndpoint(path) {
    if (!isCandidateSpendPath(path)) return false;
    try {
      const stored = await chrome.storage.local.get([SPEND_ENDPOINT_KEY]);
      if (stored[SPEND_ENDPOINT_KEY]?.path === path) return false;
      await chrome.storage.local.set({ [SPEND_ENDPOINT_KEY]: { path, learnedAt: Date.now() } });
      console.debug("[Claude Companion] learned candidate spend endpoint:", path);
      return true;
    } catch {
      return false;
    }
  }

  function firstNumericField(item, names) {
    for (const name of names) {
      const value = item?.[name];
      if (typeof value === "number" && Number.isFinite(value) && value >= 0) return { name, value };
      if (typeof value === "string" && value && Number.isFinite(Number(value))) {
        return { name, value: Number(value) };
      }
    }
    return null;
  }

  function normalizeSpendRow(item) {
    if (!item || typeof item !== "object" || Array.isArray(item)) return null;
    const CUC = globalThis.ClaudeUsageCompanion;
    const modelRaw = [item.model, item.model_id, item.model_name, item.model_family, item.name]
      .find(v => typeof v === "string" && v);
    const amount = firstNumericField(item, [
      "spend_usd", "usd", "cost_usd", "spend", "cost", "amount",
      "credits_used", "used_credits", "credits", "total_cost"
    ]);
    if (!modelRaw || !amount) return null;
    const modelKey = CUC.detectModelFromId(modelRaw) || CUC.detectModelFromText(modelRaw);
    if (!modelKey) return null;
    // Unit heuristic: credit-named fields (and large integers) are cents —
    // the known claude.ai billing endpoints all report cents. The caller's
    // monthly-counter sanity check backstops a wrong guess.
    const isCents = /credit/i.test(amount.name) || (Number.isInteger(amount.value) && amount.value >= 1000);
    const spendUsd = isCents ? amount.value / 100 : amount.value;
    const dateRaw = [item.date, item.day, item.date_key, item.period, item.timestamp]
      .find(v => typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v));
    return {
      modelKey,
      spendUsd: Number(spendUsd.toFixed(4)),
      dateKey: dateRaw ? dateRaw.slice(0, 10) : null
    };
  }

  function normalizeSpendBreakdownRows(payload) {
    const arrays = [];
    const collect = (node, depth) => {
      if (!node || depth > 4) return;
      if (Array.isArray(node)) {
        arrays.push(node);
        return;
      }
      if (typeof node === "object") {
        for (const value of Object.values(node)) collect(value, depth + 1);
      }
    };
    collect(payload, 0);

    for (const array of arrays) {
      const rows = array.map(normalizeSpendRow).filter(Boolean);
      // Confidence gate: most of the array must normalize, not just a stray
      // element that happens to have model-ish fields.
      if (rows.length && rows.length >= array.length / 2) return rows;
    }
    return null;
  }

  async function fetchSpendBreakdown(currentNative) {
    const stored = await chrome.storage.local.get([SPEND_ENDPOINT_KEY]);
    const endpoint = stored[SPEND_ENDPOINT_KEY];
    if (!endpoint?.path || !isCandidateSpendPath(endpoint.path)) return null;

    const payload = await fetchJson(`https://claude.ai${endpoint.path}`);
    const rows = normalizeSpendBreakdownRows(payload);
    if (!rows || !rows.length) return null;

    // Sanity check: the breakdown's total can't meaningfully exceed the real
    // monthly counter. If it does, the unit heuristic (or the endpoint guess)
    // is wrong — reject rather than display nonsense.
    const monthUsed = currentNative?.monthlySpendLimit?.usedUsd;
    const total = rows.reduce((sum, row) => sum + row.spendUsd, 0);
    if (typeof monthUsed === "number" && total > Math.max(monthUsed * 1.25, monthUsed + 5)) {
      console.debug("[Claude Companion] spend breakdown rejected: total", total, "vs monthly counter", monthUsed);
      return null;
    }
    return { fetchedAt: Date.now(), path: endpoint.path, rows };
  }

  globalThis.ClaudeUsageCompanionNative = {
    fetchNativeUsage,
    clearCachedOrgId,
    getCachedAccountConfig,
    rememberSpendEndpoint,
    fetchSpendBreakdown,
    formatResetCountdown,
    formatResetLabel,
    // Exposed for unit testing pure helpers; not used elsewhere in the extension.
    _internal: { nextMonthFirstDayUtcIso, normalizeSpendBreakdownRows, isCandidateSpendPath }
  };
})();
