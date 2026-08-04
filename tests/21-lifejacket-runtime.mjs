// Local inference trust-boundary contract. The service worker validates and
// forwards requests to a module offscreen host that can load only bundled q8 assets.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { EXT_PATH, assert } from "./lib.mjs";

const manifest = JSON.parse(readFileSync(join(EXT_PATH, "manifest.json"), "utf8"));
const extensionCsp = manifest.content_security_policy?.extension_pages || "";
assert(extensionCsp.includes("'wasm-unsafe-eval'"), "extension pages explicitly permit bundled ONNX WebAssembly");
assert(/worker-src[^;]*'self'[^;]*blob:/.test(extensionCsp), "local and blob workers are allowed for ONNX Runtime");
assert(!/connect-src[^;]*https:\/\/(?!claude\.ai|\*\.claude\.ai|chatgpt\.com|\*\.chatgpt\.com|chat\.openai\.com)/.test(extensionCsp),
  "Lifejacket adds no third-party network destination");

const serviceWorker = readFileSync(join(EXT_PATH, "src", "service-worker.js"), "utf8");
const providerAt = serviceWorker.indexOf('import "./openai-background.js"');
const lifejacketAt = serviceWorker.indexOf('import "./lifejacket-background.js"');
const badgeAt = serviceWorker.indexOf('import "./badge-router.js"');
assert(providerAt >= 0 && providerAt < lifejacketAt && lifejacketAt < badgeAt,
  "Lifejacket router loads after provider routers and before badge composition");

const routerPath = join(EXT_PATH, "src", "lifejacket-background.js");
assert(existsSync(routerPath), "Lifejacket background router exists");
const router = readFileSync(routerPath, "utf8");
for (const required of [
  "cuc:lifejacket-compress",
  "cuc:offscreen-compress",
  "sender.tab",
  "sender.frameId",
  "new URL(sender.url",
  "MAX_PROMPT_CHARS",
  "INFERENCE_TIMEOUT_MS",
  "chrome.offscreen.createDocument",
]) {
  assert(router.includes(required), `background router contains ${required}`);
}
assert(!router.includes("fetch(\"http"), "background router never contacts a localhost or remote compression service");

const offscreenHtml = readFileSync(join(EXT_PATH, "src", "offscreen.html"), "utf8");
assert(/<script\s+type="module"\s+src="offscreen\.js"><\/script>/.test(offscreenHtml),
  "offscreen host loads as a local ES module");
const offscreen = readFileSync(join(EXT_PATH, "src", "offscreen.js"), "utf8");
assert(offscreen.includes("cuc:offscreen-convert"), "existing file conversion relay remains available");
assert(offscreen.includes("cuc:offscreen-compress"), "offscreen host accepts Lifejacket inference requests");
assert(offscreen.includes('import("./lifejacket-runtime.js")'), "model runtime is lazy-loaded only for compression");

const runtimePath = join(EXT_PATH, "src", "lifejacket-runtime.js");
assert(existsSync(runtimePath), "Lifejacket inference runtime exists");
const runtime = readFileSync(runtimePath, "utf8");
for (const required of [
  "env.allowRemoteModels = false",
  "env.allowLocalModels = true",
  "env.localModelPath",
  'dtype: "q8"',
  'device: "wasm"',
  "mobilebert-llmlingua2-int8",
  "compressLifejacketPrompt",
]) {
  assert(runtime.includes(required), `runtime contains ${required}`);
}
assert(!/https?:\/\//.test(runtime.replace(/\/\/[^\n]*/g, "")), "runtime source has no remote model or runtime URL");

const modelPath = join(EXT_PATH, "src", "models", "lifejacket", "onnx", "model_q8.onnx");
const tokenizerPath = join(EXT_PATH, "src", "models", "lifejacket", "tokenizer.json");
const runtimeBundlePath = join(EXT_PATH, "src", "vendor", "transformers", "transformers.web.js");
if (process.env.REQUIRE_LIFEJACKET_ASSETS === "1") {
  assert(existsSync(modelPath), "release build contains the quantized model");
  assert(existsSync(tokenizerPath), "release build contains the local tokenizer");
  assert(existsSync(runtimeBundlePath), "release build contains the local Transformers.js runtime");
}

console.log("21-lifejacket-runtime PASS");
