import path from "node:path";
import {
  AutoModelForTokenClassification,
  AutoTokenizer,
  env,
} from "../node_modules/@huggingface/transformers/dist/transformers.web.js";

env.allowRemoteModels = false;
env.allowLocalModels = true;
env.useBrowserCache = false;
env.localModelPath = `${path.resolve(".")}/`;
env.backends.onnx.wasm.wasmPaths = `${path.resolve("node_modules/onnxruntime-web/dist")}/`;
env.backends.onnx.wasm.numThreads = 1;

const tokenizer = await AutoTokenizer.from_pretrained("probe-model");
const model = await AutoModelForTokenClassification.from_pretrained("probe-model", {
  dtype: "q8",
  device: "wasm",
});
const input = await tokenizer(
  "Keep Alice, Bob, invoice 42, and the June 15 deadline; remove repeated filler."
);
const output = await model(input);
const dims = output.logits.dims;
if (!Array.isArray(dims) || dims.at(-1) !== 2) {
  throw new Error(`unexpected logits shape: ${dims}`);
}
console.log(JSON.stringify({ dims, dtype: output.logits.type }));
