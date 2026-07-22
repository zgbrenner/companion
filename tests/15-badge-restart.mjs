// Badge ownership must reconcile after a service-worker or browser restart.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import vm from "node:vm";
import { EXT_PATH, assert } from "./lib.mjs";

const source = readFileSync(join(EXT_PATH, "src", "badge-state.js"), "utf8");
const STATE_KEY = "cuc:badge-state";

function storageArea(store) {
  return {
    async get(keys) {
      const result = {};
      for (const key of Array.isArray(keys) ? keys : [keys]) {
        if (Object.hasOwn(store, key)) result[key] = store[key];
      }
      return result;
    },
    async set(values) { Object.assign(store, values); },
    async remove(keys) { for (const key of Array.isArray(keys) ? keys : [keys]) delete store[key]; },
  };
}

async function boot({ state = null, badge = "95%", now = Date.now() } = {}) {
  const session = state ? { [STATE_KEY]: structuredClone(state) } : {};
  const local = {};
  const alarms = new Map();
  let badgeText = badge;
  const chrome = {
    storage: { session: storageArea(session), local: storageArea(local) },
    action: {
      async setBadgeText({ text }) { badgeText = text; },
      async setBadgeBackgroundColor() {},
    },
    alarms: {
      async create(name, info) { alarms.set(name, info); },
      async clear(name) { return alarms.delete(name); },
      onAlarm: { addListener() {} },
    },
  };
  const FakeDate = class extends Date {
    static now() { return now; }
  };
  const context = vm.createContext({ chrome, globalThis: {}, Date: FakeDate, Math, Number, String, Object, Array, Set, JSON, Promise, console });
  vm.runInContext(source, context, { filename: "src/badge-state.js" });
  const api = context.globalThis.CompanionBadgeState;
  assert(api?.ready && typeof api.ready.then === "function", "badge state exposes a startup reconciliation promise");
  await api.ready;
  return { session, local, alarms, badgeText, api };
}

const now = Date.parse("2026-07-21T20:00:00Z");

const orphan = await boot({ badge: "99%", now });
assert(orphan.badgeText === "", "an orphaned badge is cleared when no ownership state survives");

const expired = await boot({
  badge: "95%",
  now,
  state: { provider: "openai", observedAt: now - 3 * 60 * 60_000, expiresAt: now - 60 * 60_000, alarmName: "old-alarm" },
});
assert(expired.badgeText === "", "an expired OpenAI badge is cleared on startup");
assert(!expired.session[STATE_KEY], "expired OpenAI ownership is removed on startup");

const observedAt = now - 30 * 60_000;
const expiresAt = now + 90 * 60_000;
const future = await boot({
  badge: "92%",
  now,
  state: { provider: "openai", observedAt, expiresAt, alarmName: null },
});
const expectedAlarm = `cuc:badge-expiry:openai:${observedAt}`;
assert(future.badgeText === "92%", "a current OpenAI badge remains visible");
assert(future.alarms.get(expectedAlarm)?.when === expiresAt, "a missing future OpenAI expiry alarm is recreated");
assert(future.session[STATE_KEY]?.alarmName === expectedAlarm, "recreated alarm ownership is persisted");

const claude = await boot({
  badge: "88%",
  now,
  state: { provider: "claude", observedAt: now - 10_000, expiresAt: null, alarmName: null },
});
assert(claude.badgeText === "88%", "a valid Claude-owned badge survives a service-worker restart");
assert(claude.alarms.size === 0, "Claude ownership never schedules an OpenAI expiry alarm");

console.log("15-badge-restart PASS");
