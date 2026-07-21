// Provider-aware badge ownership: stale OpenAI cleanup must never erase a newer
// Claude badge, and old OpenAI expiry alarms must not clear newer readings.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import vm from "node:vm";
import { EXT_PATH, assert } from "./lib.mjs";

const session = {};
const local = {};
let badgeText = "";
let badgeColor = null;
const alarms = new Map();
const alarmListeners = [];

function storageArea(store) {
  return {
    async get(keys) {
      if (keys == null) return { ...store };
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

const chrome = {
  storage: {
    session: storageArea(session),
    local: storageArea(local),
  },
  action: {
    async setBadgeText({ text }) { badgeText = text; },
    async setBadgeBackgroundColor({ color }) { badgeColor = color; },
  },
  alarms: {
    async create(name, info) { alarms.set(name, info); },
    async clear(name) { return alarms.delete(name); },
    onAlarm: { addListener(listener) { alarmListeners.push(listener); } },
  },
};

const context = vm.createContext({ chrome, globalThis: {}, Date, Math, Number, String, Object, Array, JSON, Promise, console });
const source = readFileSync(join(EXT_PATH, "src", "badge-state.js"), "utf8");
vm.runInContext(source, context, { filename: "src/badge-state.js" });
const badge = context.globalThis.CompanionBadgeState;
assert(badge, "shared badge-state helper is exported");
assert(alarmListeners.length === 1, "badge-state registers one alarm handler");

const t1 = Date.parse("2026-07-21T20:00:00Z");
const t2 = t1 + 60_000;
const expiry1 = t1 + 2 * 60 * 60_000;
const expiry2 = t2 + 2 * 60 * 60_000;

await badge.set({ provider: "openai", observedAt: t1, text: "95%", color: "#b42318", expiresAt: expiry1 });
assert(badgeText === "95%", `OpenAI badge should display 95%, got ${badgeText}`);
assert(badgeColor === "#b42318", "OpenAI badge color is applied");
assert(alarms.has(`cuc:badge-expiry:openai:${t1}`), "OpenAI expiry alarm is scheduled");

await badge.set({ provider: "claude", observedAt: t2, text: "88%", color: "#b4791f" });
assert(badgeText === "88%", "newer Claude badge replaces OpenAI badge");
await badge.clearIfCurrent("openai", t1);
assert(badgeText === "88%", "old OpenAI cleanup cannot clear a newer Claude badge");

await badge.set({ provider: "openai", observedAt: t2, text: "97%", color: "#b42318", expiresAt: expiry2 });
assert(badgeText === "97%", "newer OpenAI badge is displayed");
await badge.clearIfCurrent("openai", t1);
assert(badgeText === "97%", "old OpenAI snapshot cannot clear a newer OpenAI badge");

await alarmListeners[0]({ name: `cuc:badge-expiry:openai:${t1}` });
assert(badgeText === "97%", "stale alarm cannot clear the current OpenAI badge");
await alarmListeners[0]({ name: `cuc:badge-expiry:openai:${t2}` });
assert(badgeText === "", "current OpenAI expiry alarm clears the stale badge");

const stored = session["cuc:badge-state"];
assert(!stored, "badge ownership state is removed after current expiry");

console.log("13-badge-ownership PASS");
