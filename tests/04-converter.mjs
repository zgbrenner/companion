// End-to-end Caveman file conversion through the REAL pipeline: service
// worker → offscreen document → sandboxed parser → Markdown back.
import { launchExtension, assert } from "./lib.mjs";
import { execFileSync } from "node:child_process";
import { readFileSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Minimal valid DOCX built with python3's zipfile (a docx is a zip of XML).
function buildDocx(dir) {
  const script = `
import zipfile, sys
path = sys.argv[1]
ct = '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'
rels = '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>'
doc = '<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Converter Test Heading</w:t></w:r></w:p><w:p><w:r><w:t>A plain paragraph for the pipeline test.</w:t></w:r></w:p></w:body></w:document>'
with zipfile.ZipFile(path, "w") as z:
    z.writestr("[Content_Types].xml", ct)
    z.writestr("_rels/.rels", rels)
    z.writestr("word/document.xml", doc)
`;
  const path = join(dir, "test.docx");
  execFileSync("python3", ["-c", script, path]);
  return path;
}

function toDataUrl(path, mime) {
  return `data:${mime};base64,${readFileSync(path).toString("base64")}`;
}

const dir = mkdtempSync(join(tmpdir(), "cuc-conv-"));
const docxPath = buildDocx(dir);
const csvPath = join(dir, "test.csv");
writeFileSync(csvPath, "Name,Age\nAlice,30\nBob,25\n");

const { context, worker } = await launchExtension();
try {
  // chrome.offscreen binding can lag under CDP — wait for it explicitly.
  for (let i = 0; i < 50; i += 1) {
    const ready = await worker.evaluate(() => !!chrome.offscreen).catch(() => false);
    if (ready) break;
    await new Promise(resolve => setTimeout(resolve, 100));
  }

  const convert = (dataUrl, ext) =>
    worker.evaluate(async ({ dataUrl, ext }) => {
      // Mirror background.js's own handler: ensure the offscreen document,
      // then relay the same message it sends.
      if (!(await chrome.offscreen.hasDocument())) {
        await chrome.offscreen.createDocument({
          url: "src/offscreen.html",
          reasons: ["DOM_PARSER"],
          justification: "test drive of the file conversion pipeline",
        });
      }
      return chrome.runtime.sendMessage({ type: "cuc:offscreen-convert", dataUrl, ext });
    }, { dataUrl, ext });

  const docx = await convert(
    toDataUrl(docxPath, "application/vnd.openxmlformats-officedocument.wordprocessingml.document"),
    "docx"
  );
  assert(docx?.ok === true, `docx conversion failed: ${docx?.error}`);
  assert(/Converter Test Heading/.test(docx.markdown), "docx heading survives conversion");
  assert(/plain paragraph/.test(docx.markdown), "docx body text survives conversion");

  const csv = await convert(toDataUrl(csvPath, "text/csv"), "csv");
  assert(csv?.ok === true, `csv conversion failed: ${csv?.error}`);
  assert(/Alice/.test(csv.markdown) && /\|/.test(csv.markdown), "csv becomes a markdown table");

  // An empty file must error cleanly, never hang or return scaffolding.
  const empty = await convert("data:text/csv;base64,", "csv");
  assert(empty?.ok === false, "empty csv should fail with a readable error");

  console.log("04-converter PASS");
} finally {
  await context.close();
}
