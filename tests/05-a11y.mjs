// axe-core audit of the options and popup pages (seeded state). Skips
// gracefully when axe-core isn't installed (CI installs it; see README).
import { launchExtension, openPage, assert, seedScript } from "./lib.mjs";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";

let axeSource;
try {
  const require = createRequire(import.meta.url);
  axeSource = readFileSync(require.resolve("axe-core/axe.min.js"), "utf8");
} catch {
  console.log("05-a11y SKIP (axe-core not installed — `npm install --no-save axe-core`)");
  process.exit(0);
}

const { context, extensionId } = await launchExtension();
try {
  for (const file of ["options.html", "popup.html"]) {
    const { page } = await openPage(context, extensionId, file);
    if (file === "popup.html") {
      await page.evaluate(seedScript());
      await page.reload();
      await page.waitForTimeout(800);
    }
    // Inject axe via CDP evaluation, NOT addScriptTag: an inline <script>
    // tag is (correctly) blocked by the extension pages' own CSP
    // (script-src 'self'); Runtime.evaluate is not subject to page CSP.
    await page.evaluate(axeSource);
    const results = await page.evaluate(() =>
      window.axe.run(document, { resultTypes: ["violations"] })
    );
    const serious = results.violations.filter(v =>
      v.impact === "serious" || v.impact === "critical"
    );
    const details = serious.map(violation => {
      const targets = violation.nodes.map(node => {
        const target = Array.isArray(node.target) ? node.target.join(" ") : String(node.target || "unknown");
        const summary = String(node.failureSummary || "").replace(/\s+/g, " ").trim();
        return `${target}${summary ? `: ${summary}` : ""}`;
      }).join(" | ");
      return `${violation.id} (${violation.impact}) x${violation.nodes.length}${targets ? ` [${targets}]` : ""}`;
    }).join(", ");
    assert(serious.length === 0, `${file}: ${details}`);
    console.log(`  ${file}: 0 serious/critical violations`);
    await page.close();
  }
  console.log("05-a11y PASS");
} finally {
  await context.close();
}
