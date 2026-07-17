// Runs every numbered test sequentially and reports a summary. No test
// framework — each test is a plain node script that exits non-zero on
// failure. See tests/README.md for local-run setup.
import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const dir = dirname(fileURLToPath(import.meta.url));
const tests = readdirSync(dir).filter(f => /^\d\d-.*\.mjs$/.test(f)).sort();

const results = [];
for (const test of tests) {
  const started = Date.now();
  const run = spawnSync(process.execPath, [join(dir, test)], {
    stdio: "inherit",
    env: process.env,
  });
  results.push({ test, code: run.status ?? 1, ms: Date.now() - started });
}

console.log("\n── summary ──");
let failed = 0;
for (const { test, code, ms } of results) {
  const state = code === 0 ? "PASS" : "FAIL";
  if (code !== 0) failed += 1;
  console.log(`${state}  ${test}  (${(ms / 1000).toFixed(1)}s)`);
}
process.exit(failed ? 1 : 0);
