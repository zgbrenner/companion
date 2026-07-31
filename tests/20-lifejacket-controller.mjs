// Provider-neutral Lifejacket controller contract: model inference runs on every
// enabled prompt, failures preserve the original, and reply guidance is appended.
import vm from "node:vm";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { EXT_PATH, assert } from "./lib.mjs";

const calls = [];
let mode = "success";
const chrome = {
  runtime: {
    async sendMessage(message) {
      calls.push(structuredClone(message));
      if (mode === "throw") throw new Error("offscreen unavailable");
      if (mode === "error") return { ok: false, error: "model failed" };
      return {
        ok: true,
        text: message.text.length < 10 ? message.text : "Keep names 42 and deadline.",
        originalChars: message.text.length,
        compressedChars: message.text.length < 10 ? message.text.length : 27,
        savedPct: message.text.length < 10 ? 0 : 61,
        model: "mobilebert-llmlingua2-int8",
        backend: "wasm",
      };
    },
  },
};

const context = {
  chrome,
  console: { log() {}, warn() {}, error() {} },
  Date,
  Math,
  Promise,
  String,
  Object,
  Array,
  Number,
  Boolean,
  RegExp,
  Error,
  TypeError,
  structuredClone,
  setTimeout,
  clearTimeout,
};
context.globalThis = context;
vm.createContext(context);
vm.runInContext(readFileSync(join(EXT_PATH, "src", "lifejacket.js"), "utf8"), context, { filename: "lifejacket.js" });

const LIFEJACKET = context.CompanionLifejacket;
assert(LIFEJACKET, "Lifejacket controller exports CompanionLifejacket");
assert(typeof LIFEJACKET.compressPrompt === "function", "compressPrompt is exported");
assert(typeof LIFEJACKET.appendReplyInstruction === "function", "appendReplyInstruction is exported");

const longInput = "Please keep the names Alice and Bob, the number 42, and the deadline while shortening repeated wording.";
const first = await LIFEJACKET.compressPrompt(longInput);
const second = await LIFEJACKET.compressPrompt("Hi");
assert(calls.length === 2, `compressor runs for every enabled send, including short prompts; calls=${calls.length}`);
for (const call of calls) {
  assert(call.type === "cuc:lifejacket-compress", "controller uses the Lifejacket compression message");
  assert(call.options?.keepRate === LIFEJACKET.DEFAULT_KEEP_RATE, "controller sends the conservative default keep rate");
}
assert(first.text === "Keep names 42 and deadline.", "successful local result is returned");
assert(first.changed === true && first.failed === false, "successful compression reports changed without failure");
assert(first.model === "mobilebert-llmlingua2-int8" && first.backend === "wasm", "model metadata is preserved");
assert(second.text === "Hi" && second.changed === false, "short prompt still runs through the model and may remain unchanged");

mode = "error";
const failedResponse = await LIFEJACKET.compressPrompt(longInput);
assert(failedResponse.text === longInput, "background errors fail open to the original prompt");
assert(failedResponse.failed === true, "background errors are visible to the caller");
assert(/model failed/i.test(failedResponse.warning), "bounded model error is exposed as a warning");

mode = "throw";
const thrownResponse = await LIFEJACKET.compressPrompt(longInput);
assert(thrownResponse.text === longInput, "transport errors fail open to the original prompt");
assert(thrownResponse.failed === true, "transport error is marked failed");
assert(/offscreen unavailable/i.test(thrownResponse.warning), "transport error is surfaced without throwing");

const userText = "Analyze the attached contract and preserve every deadline.";
const withInstruction = LIFEJACKET.appendReplyInstruction(userText, "instruction");
assert(withInstruction.startsWith(userText), "reply instruction never precedes the user prompt");
assert(withInstruction.endsWith(LIFEJACKET.LIFEJACKET_REPLY_INSTRUCTION), "full reply instruction is appended at the end");
assert(withInstruction.indexOf(LIFEJACKET.LIFEJACKET_REPLY_INSTRUCTION) > userText.length,
  "full instruction follows the complete user text");

const withReminder = LIFEJACKET.appendReplyInstruction(userText, "reminder");
assert(withReminder.startsWith(userText), "reply reminder never precedes the user prompt");
assert(withReminder.endsWith(LIFEJACKET.LIFEJACKET_REPLY_REMINDER), "reply reminder is appended at the end");
assert(LIFEJACKET.LIFEJACKET_REMINDER_EVERY_N_RESPONSES === 12, "long-chat reminder cadence remains bounded");

console.log("20-lifejacket-controller PASS");
