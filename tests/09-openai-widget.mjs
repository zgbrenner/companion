// ChatGPT integration harness: intercepted first-party page with a realistic
// composer, surface switching, dark mode, and safe Caveman preview behavior.
import { launchExtension, assert } from "./lib.mjs";

const { context, worker } = await launchExtension();
try {
  await worker.evaluate(async () => {
    await chrome.storage.local.set({
      "cuc:settings": { cavemanMode: true, showCavemanMode: true, showWidget: true },
    });
  });

  await context.route("https://chatgpt.com/**", async route => {
    await route.fulfill({
      status: 200,
      contentType: "text/html",
      body: `<!doctype html>
        <html lang="en">
          <head><meta charset="utf-8"><title>ChatGPT harness</title></head>
          <body style="margin:0;background:rgb(255,255,255);font-family:Arial,sans-serif">
            <header><button aria-pressed="true" data-testid="mode-selector">Chat</button></header>
            <main style="min-height:100vh;display:flex;flex-direction:column;justify-content:flex-end;align-items:center">
              <section id="composer-shell" style="width:680px;border:1px solid #ddd;border-radius:26px;background:white;padding:10px;box-sizing:border-box">
                <form data-testid="composer" style="display:flex;gap:8px">
                  <div id="prompt-textarea" role="textbox" contenteditable="true" style="flex:1;min-height:42px"></div>
                  <button type="submit" data-testid="send-button" aria-label="Send prompt">Send</button>
                </form>
              </section>
            </main>
          </body>
        </html>`,
    });
  });

  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", error => errors.push(`pageerror: ${error}`));
  page.on("console", message => { if (message.type() === "error") errors.push(`console: ${message.text()}`); });
  await page.goto("https://chatgpt.com/c/67f4d38d-1234-5678-9abc-001122334455");
  await page.waitForSelector("#cuc-openai-widget", { timeout: 10000 });

  const initial = await page.evaluate(() => {
    const host = document.querySelector("#cuc-openai-widget");
    return { text: host?.shadowRoot?.textContent || "", width: host?.getBoundingClientRect().width || 0 };
  });
  assert(initial.text.includes("Companion"), "widget renders Companion title");
  assert(initial.text.includes("Chat"), "widget detects Chat surface");
  assert(initial.width > 600 && initial.width < 720, `widget follows composer width, got ${initial.width}`);

  await page.evaluate(() => {
    history.pushState({}, "", "/?mode=work");
    document.querySelector("[data-testid='mode-selector']").textContent = "Work";
    window.dispatchEvent(new PopStateEvent("popstate"));
  });
  await page.waitForFunction(() => document.querySelector("#cuc-openai-widget")?.shadowRoot?.textContent?.includes("Work"));

  await page.evaluate(() => document.documentElement.classList.add("dark"));
  await page.waitForFunction(() => document.querySelector("#cuc-openai-widget")?.classList.contains("cuc-openai-dark"));

  await page.locator("#prompt-textarea").fill("Could you please basically summarize this very long request?");
  await page.locator("#prompt-textarea").press("Enter");
  await page.waitForFunction(() => {
    const root = document.querySelector("#cuc-openai-widget")?.shadowRoot;
    return !root?.querySelector("[data-cuc-openai='trim-dialog']")?.hasAttribute("hidden");
  });
  const preview = await page.evaluate(() => document.querySelector("#cuc-openai-widget")?.shadowRoot?.querySelector("[data-cuc-openai='trim-text']")?.value || "");
  assert(preview.length > 0 && preview.length < "Could you please basically summarize this very long request?".length, "Caveman preview offers a shorter prompt");
  assert(errors.length === 0, `ChatGPT harness errors: ${errors.join(" | ")}`);

  await page.close();
  console.log("09-openai-widget PASS");
} finally {
  await context.close();
}
