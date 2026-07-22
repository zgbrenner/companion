// Only CompanionBadgeState may write the toolbar badge inside the service worker.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import vm from "node:vm";
import { EXT_PATH, assert } from "./lib.mjs";

const session = {};
const local = {};
let badgeText = "";
let badgeColor = null;

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

const directCalls = [];
const chrome = {
  storage: { session: storageArea(session), local: storageArea(local) },
  action: {
    async setBadgeText({ text }) { directCalls.push(["text", text]); badgeText = text; },
    async setBadgeBackgroundColor({ color }) { directCalls.push(["color", color]); badgeColor = color; },
  },
  alarms: {
    async create() {},
    async clear() { return true; },
    onAlarm: { addListener() {} },
  },
};

const context = vm.createContext({ chrome, globalThis: {}, Date, Math, Number, String, Object, Array, Set, JSON, Promise, console });
const source = readFileSync(join(EXT_PATH, "src", "badge-state.js"), "utf8");
vm.runInContext(source, context, { filename: "src/badge-state.js" });
const badge = context.globalThis.CompanionBadgeState;
await badge.ready;

directCalls.length = 0;
badgeText = "";
badgeColor = null;

await chrome.action.setBadgeText({ text: "99%" });
await chrome.action.setBadgeBackgroundColor({ color: "#ff0000" });
assert(badgeText === "", "a legacy direct service-worker write cannot change badge text");
assert(badgeColor === null, "a legacy direct service-worker write cannot change badge color");
assert(directCalls.length === 0, "blocked direct writes never reach the native Chrome API");

await badge.set({ provider: "claude", observedAt: 1000, text: "88%", color: "#b4791f" });
assert(badgeText === "88%", "the authoritative badge owner can write text");
assert(badgeColor === "#b4791f", "the authoritative badge owner can write color");
assert(directCalls.some(([kind, value]) => kind === "text" && value === "88%"), "owned text write reaches the captured native API");

await chrome.action.setBadgeText({ text: "12%" });
assert(badgeText === "88%", "a later legacy write cannot overwrite owned badge state");

await badge.clearIfCurrent("claude", 1000);
assert(badgeText === "", "the authoritative owner can clear its current badge");

console.log("16-single-badge-writer PASS");
