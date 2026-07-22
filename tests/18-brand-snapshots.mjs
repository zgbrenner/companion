// Rendered brand review for the three extension-owned surfaces.
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { launchExtension, openPage, assert, seedScript, EXT_PATH } from "./lib.mjs";

const output = join(EXT_PATH, "test-artifacts", "brand");
mkdirSync(output, { recursive: true });

const { context, extensionId } = await launchExtension();
try {
  const surfaces = [
    { file: "options.html", width: 1280, height: 900, seed: false },
    { file: "popup.html", width: 320, height: 760, seed: true },
    { file: "openai-popup.html", width: 370, height: 600, seed: false },
  ];

  for (const surface of surfaces) {
    const { page, errors } = await openPage(context, extensionId, surface.file);
    await page.setViewportSize({ width: surface.width, height: surface.height });
    if (surface.seed) {
      await page.evaluate(seedScript());
      await page.reload();
      await page.waitForTimeout(800);
    }

    const identity = await page.evaluate(() => {
      const brand = document.querySelector("h1, .brand-name");
      const mark = document.querySelector(".brand-mark, .mark");
      const bodyFont = getComputedStyle(document.body).fontFamily;
      const brandFont = brand ? getComputedStyle(brand).fontFamily : "";
      return {
        brandText: brand?.textContent?.trim() || "",
        markSource: mark?.getAttribute("src") || "",
        bodyFont,
        brandFont,
      };
    });

    assert(identity.brandText === "COMPANION", `${surface.file} renders the all-caps wordmark`);
    assert(identity.markSource.endsWith("/icons/orbit-c.svg"), `${surface.file} renders Orbit C`);
    assert(identity.bodyFont.includes("Atkinson Hyperlegible Next"), `${surface.file} computes the Atkinson UI font`);
    assert(identity.brandFont.includes("League Spartan"), `${surface.file} computes the League Spartan wordmark`);
    assert(errors.length === 0, `${surface.file} brand render errors: ${errors.join(" | ")}`);

    await page.screenshot({
      path: join(output, surface.file.replace(".html", ".png")),
      fullPage: true,
    });
    await page.close();
  }

  console.log("18-brand-snapshots PASS");
} finally {
  await context.close();
}
