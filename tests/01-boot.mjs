// Extension boots: service worker present, options + popup load cleanly.
import { launchExtension, openPage, assert } from "./lib.mjs";

const { context, extensionId } = await launchExtension();
try {
  assert(extensionId?.length === 32, `extension id looks wrong: ${extensionId}`);

  for (const file of ["options.html", "popup.html"]) {
    const { page, errors } = await openPage(context, extensionId, file);
    assert(errors.length === 0, `${file} errors: ${errors.join(" | ")}`);
    await page.close();
  }
  console.log("01-boot PASS");
} finally {
  await context.close();
}
