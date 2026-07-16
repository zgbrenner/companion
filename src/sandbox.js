// Runs inside a manifest-declared sandbox page (opaque origin, NO chrome.*
// access, no extension-origin privileges). This is where the vendored
// third-party officeparser actually parses untrusted file bytes — so even a
// hypothetical parser exploit is boxed in here: it can't touch extension
// storage, the network (connect-src 'none'), Claude's session, or any
// chrome API. The privileged offscreen document relays bytes in and Markdown
// out over postMessage; nothing else crosses the boundary.

const MAX_MARKDOWN_CHARS = 800_000;

async function convert(bytes, ext, workerSource) {
  let workerBlobUrl = null;
  // pdfjs needs a worker, but a sandboxed opaque origin can't spawn a
  // chrome-extension:// (cross-origin) worker. The offscreen side reads the
  // worker file (it has extension-origin access) and hands us its source; we
  // run it from a same-origin blob URL, keeping the worker inside the sandbox.
  if (workerSource) {
    workerBlobUrl = URL.createObjectURL(new Blob([workerSource], { type: "text/javascript" }));
  }
  // The vendored parser's format switch only knows "html" — map the equally
  // common .htm extension onto it instead of letting it throw "unsupported".
  const fileType = ext === "htm" ? "html" : ext;
  const parserConfig = { fileType, ocr: false };
  if (workerBlobUrl) parserConfig.pdfWorkerSrc = workerBlobUrl;

  try {
    let markdown = null;
    try {
      const result = await globalThis.officeParser.convert(bytes, "md", {
        parseConfig: parserConfig,
        generatorConfig: { includeImages: false }
      });
      markdown = typeof result === "string" ? result : result?.value;
    } catch {
      // Fall through to the plain-text AST path below.
    }
    if (!markdown || !String(markdown).trim()) {
      const ast = await globalThis.officeParser.parseOffice(bytes, parserConfig);
      markdown = ast?.toText?.();
    }
    markdown = String(markdown || "").trim();
    // The parser wraps sheets/sections in YAML frontmatter (`--- title:
    // "Sheet1" ---`) plus bare `---` separators — scaffolding that reads as
    // noise when pasted into a chat. Rewrite titled frontmatter into a plain
    // heading, drop the rest, and judge emptiness on what remains (an empty
    // sheet must error, not paste leftover scaffolding).
    markdown = markdown
      .replace(/(?:^|\n)---\n([\s\S]*?)\n---(?=\n|$)/g, (block, body) => {
        // Only treat the block as frontmatter when every line is `key: value`
        // (or blank) — two legitimate `---` rules with document text between
        // them must survive untouched.
        if (!/^(?:[\w-]+:[^\n]*|\s*)(?:\n(?:[\w-]+:[^\n]*|\s*))*$/.test(body)) return block;
        const title = /(?:^|\n)title:\s*"?([^"\n]+?)"?\s*$/m.exec(body)?.[1]?.trim();
        return title ? `\n## ${title}` : "\n";
      })
      .replace(/^\s*---\s*$/gm, "")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
    // Emptiness is judged ignoring headings: a sheet name promoted to "##
    // Sheet1" above isn't content — an empty sheet must still error rather
    // than paste a lone heading into the chat.
    if (!markdown.replace(/^#{1,6} .*$/gm, "").trim()) {
      throw new Error("no extractable text found in the file");
    }
    if (markdown.length > MAX_MARKDOWN_CHARS) {
      markdown = `${markdown.slice(0, MAX_MARKDOWN_CHARS)}\n\n[truncated — file text exceeded ${MAX_MARKDOWN_CHARS.toLocaleString()} characters]`;
    }
    return markdown;
  } finally {
    if (workerBlobUrl) URL.revokeObjectURL(workerBlobUrl);
  }
}

window.addEventListener("message", async event => {
  const message = event.data;
  if (!message || message.type !== "cuc:sandbox-convert" || typeof message.id !== "string") return;
  // Reply to whoever sent this (the offscreen parent). Opaque-origin frames
  // can't be origin-checked, so the offscreen side matches on message.id.
  const reply = payload => event.source?.postMessage({ type: "cuc:sandbox-result", id: message.id, ...payload }, "*");
  try {
    const bytes = message.bytes instanceof ArrayBuffer ? new Uint8Array(message.bytes) : new Uint8Array(message.bytes || []);
    const markdown = await convert(bytes, String(message.ext || "").toLowerCase(), message.workerSource || null);
    reply({ ok: true, markdown });
  } catch (error) {
    reply({ ok: false, error: String(error?.message || error) });
  }
});

// Tell the offscreen host we're loaded and ready to receive work.
try { window.parent?.postMessage({ type: "cuc:sandbox-ready" }, "*"); } catch {}
