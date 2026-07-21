// ChatGPT integration harness: intercepted first-party page with a realistic
// composer, native usage response, surface switching, dark mode, safe Caveman
// preview behavior, and a page-world attempt to steal the old bridge token.
import { launchExtension, assert } from "./lib.mjs";

const { context, worker } = await launchExtension();
try {
  await worker.evaluate(async () => {
    await chrome.storage.local.set({
      "cuc:settings": { cavemanMode: true, showCavemanMode: true, showWidget: true },
    });
  });

  await context.route("https://chatgpt.com/**", async route => {
    const url = new URL(route.request().url());
    if (url.pathname === "/backend-api/usage") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          profile: { name: "Browser Fixture", email: "fixture@example.com" },
          agentic_usage: {
            used_credits: 40,
            credit_limit: 100,
            resets_at: new Date(Date.now() + 3600e3).toISOString(),
          },
        }),
      });
      return;
    }
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
                <form data-testid="composer" style="display:flex;gap:8px" onsubmit="event.preventDefault()">
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

  const attack = await page.evaluate(async () => {
    let leakedToken = null;
    let leakedChannel = null;
    const tokenListener = event => { leakedToken = event?.detail?.token || null; };
    const channelListener = event => { leakedChannel = event?.detail?.channelId || null; };
    window.addEventListener("cuc:openai-token-offer", tokenListener);
    window.addEventListener("cuc:openai-channel-offer", channelListener);
    window.dispatchEvent(new CustomEvent("cuc:openai-main-ready"));
    await new Promise(resolve => setTimeout(resolve, 80));
    if (leakedToken) {
      window.dispatchEvent(new CustomEvent("cuc:openai-usage-snapshot", {
        detail: {
          token: leakedToken,
          snapshot: {
            provider: "openai",
            observedAt: Date.now(),
            sourcePath: "/forged",
            maxUtilizationPct: 99,
            buckets: [{ key: "agentic", label: "Forged usage", pct: 99, resetsAt: null, used: 99, limit: 100, unit: "credits" }],
            counters: {},
          },
        },
      }));
    }
    window.removeEventListener("cuc:openai-token-offer", tokenListener);
    window.removeEventListener("cuc:openai-channel-offer", channelListener);
    return { leakedToken, leakedChannel };
  });
  assert(!attack.leakedToken, "page cannot force the legacy authentication token to be re-broadcast");
  assert(!attack.leakedChannel, "page cannot force a private bridge identifier to be re-broadcast");
  await page.waitForTimeout(100);
  const afterAttack = await page.evaluate(() => document.querySelector("#cuc-openai-widget")?.shadowRoot?.textContent || "");
  assert(!afterAttack.includes("Forged usage"), "page-forged usage events never reach the widget");

  const bridgeDiagnostic = await page.evaluate(async () => {
    const beforeState = document.documentElement.getAttribute("data-companion-openai-bridge");
    const fetchName = window.fetch.name;
    const installed = Boolean(window.__COMPANION_OPENAI_INSTALLED__);
    const response = await fetch("/backend-api/usage?access_token=browser-secret&conversation=private-id");
    await new Promise(resolve => setTimeout(resolve, 200));
    return {
      fetchName,
      installed,
      contentType: response.headers.get("content-type"),
      status: response.status,
      beforeState,
      afterState: document.documentElement.getAttribute("data-companion-openai-bridge"),
    };
  });
  assert(bridgeDiagnostic.installed, `MAIN observer missing: ${JSON.stringify(bridgeDiagnostic)}`);
  assert(bridgeDiagnostic.fetchName === "companionOpenAIFetch", `fetch was not patched: ${JSON.stringify(bridgeDiagnostic)}`);
  try {
    await page.waitForFunction(() => {
      const text = document.querySelector("#cuc-openai-widget")?.shadowRoot?.textContent || "";
      return text.includes("Agentic usage") && text.includes("40 credits");
    }, undefined, { timeout: 10000 });
  } catch (error) {
    const finalState = await page.evaluate(() => document.documentElement.getAttribute("data-companion-openai-bridge"));
    const widgetText = await page.evaluate(() => document.querySelector("#cuc-openai-widget")?.shadowRoot?.textContent || "");
    throw new Error(`native usage did not reach widget; diagnostic=${JSON.stringify({ ...bridgeDiagnostic, finalState })}; widget=${JSON.stringify(widgetText)}; ${error}`);
  }
  const afterNativeUsage = await page.evaluate(() => document.querySelector("#cuc-openai-widget")?.shadowRoot?.textContent || "");
  assert(!afterNativeUsage.includes("Browser Fixture"), "profile names never reach the widget");
  assert(!afterNativeUsage.includes("fixture@example.com"), "profile emails never reach the widget");
  assert(!afterNativeUsage.includes("browser-secret"), "usage URL query values never reach the widget");

  await page.evaluate(() => {
    history.pushState({}, "", "/?mode=work");
    document.querySelector("[data-testid='mode-selector']").textContent = "Work";
    window.dispatchEvent(new PopStateEvent("popstate"));
  });
  await page.waitForFunction(() => document.querySelector("#cuc-openai-widget")?.shadowRoot?.textContent?.includes("Work"));

  await page.evaluate(() => document.documentElement.classList.add("dark"));
  await page.waitForFunction(() => document.querySelector("#cuc-openai-widget")?.classList.contains("cuc-openai-dark"));

  await page.locator("#prompt-textarea").fill("Could you please basically summarize this very long request?");
  const intercepted = await page.evaluate(async () => {
    const editable = document.querySelector("#prompt-textarea");
    const deadline = Date.now() + 2000;
    while (Date.now() < deadline) {
      const event = new KeyboardEvent("keydown", {
        key: "Enter",
        code: "Enter",
        keyCode: 13,
        which: 13,
        bubbles: true,
        cancelable: true,
      });
      const dispatched = editable.dispatchEvent(event);
      if (!dispatched && event.defaultPrevented) return true;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    return false;
  });
  assert(intercepted, "Caveman Mode intercepts the composer Enter event before native submission");
  await page.waitForFunction(() => {
    const root = document.querySelector("#cuc-openai-widget")?.shadowRoot;
    return !root?.querySelector("[data-cuc-openai='trim-dialog']")?.hasAttribute("hidden");
  }, undefined, { timeout: 10000 });
  const preview = await page.evaluate(() => document.querySelector("#cuc-openai-widget")?.shadowRoot?.querySelector("[data-cuc-openai='trim-text']")?.value || "");
  assert(preview.length > 0 && preview.length < "Could you please basically summarize this very long request?".length, "Caveman preview offers a shorter prompt");
  assert(errors.length === 0, `ChatGPT harness errors: ${errors.join(" | ")}`);

  await page.close();
  console.log("09-openai-widget PASS");
} finally {
  await context.close();
}
