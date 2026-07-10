// Offscreen conversion service (see offscreen.html for why this exists).
// Receives {type:"cuc:offscreen-convert", dataUrl, ext} from the background
// router, converts with the vendored officeparser slim bundle, and replies
// {ok, markdown} — the file's bytes never leave the machine.

const MAX_MARKDOWN_CHARS = 800_000;

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type !== "cuc:offscreen-convert") return false;
  // Only the extension's own background router may drive conversions —
  // reject anything relayed from a tab.
  if (sender?.id !== chrome.runtime.id || sender?.tab) return false;
  (async () => {
    const response = await fetch(message.dataUrl);
    const bytes = new Uint8Array(await response.arrayBuffer());
    const ext = String(message.ext || "").toLowerCase();
    const parserConfig = {
      fileType: ext,
      ocr: false,
      // Same-origin worker for PDF parsing; version-matched to the bundled
      // pdfjs-dist (6.1.200 — see src/vendor/).
      pdfWorkerSrc: chrome.runtime.getURL("src/vendor/pdf.worker.min.mjs")
    };

    let markdown = null;
    let convertError = null;
    try {
      // One-step convert straight to Markdown. NOTE: the converter's config
      // key is `parseConfig` (verified against the package's types.d.ts) —
      // the standalone parseOffice() below takes the same object directly.
      const result = await globalThis.officeParser.convert(bytes, "md", {
        parseConfig: parserConfig,
        generatorConfig: { includeImages: false }
      });
      markdown = typeof result === "string" ? result : result?.value;
    } catch (error) {
      convertError = error;
    }
    if (!markdown || !String(markdown).trim()) {
      // Fallback: parse to AST and take plain text — better than failing
      // outright if the markdown generator chokes on an odd document.
      try {
        const ast = await globalThis.officeParser.parseOffice(bytes, parserConfig);
        markdown = ast?.toText?.();
      } catch (error) {
        throw convertError || error;
      }
    }
    markdown = String(markdown || "").trim();
    if (!markdown) throw new Error("no extractable text found in the file");
    if (markdown.length > MAX_MARKDOWN_CHARS) {
      markdown = `${markdown.slice(0, MAX_MARKDOWN_CHARS)}\n\n[truncated — file text exceeded ${MAX_MARKDOWN_CHARS.toLocaleString()} characters]`;
    }
    sendResponse({ ok: true, markdown });
  })().catch(error => {
    sendResponse({ ok: false, error: String(error?.message || error) });
  });
  return true; // async sendResponse
});
