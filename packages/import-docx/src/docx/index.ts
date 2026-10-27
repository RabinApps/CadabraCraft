import { AssetRegistry, Warnings, splitChapters } from "../common";
import { ImportError, type ImportOptions, type ImportResult } from "../types";
import { readArchive } from "./archive";
import { BodyBuilder } from "./body";
import { collectNotes } from "./notes";
import { parseNumbering } from "./numbering";
import { parseRels } from "./relationships";
import { parseStyles } from "./styles";
import type { DCtx } from "./types";
import { child, childrenNamed, kids, parseXml, rawText, tagOf } from "./xml";

/** Import a .docx file held in memory. Pure: no disk or network access; image bytes are returned in `assets`. */
export function importDocx(bytes: Uint8Array, opts: ImportOptions = {}): ImportResult {
  const files = readArchive(bytes, opts);

  const warn = new Warnings();
  const topRels = parseRels(files["_rels/.rels"], "_rels/.rels");
  let docPath = "word/document.xml";
  for (const r of topRels.values()) if (/\/(word\/)?document\.xml$/i.test(r.target) && !r.external) docPath = r.target.replace(/^\//, "");
  const docBytes = files[docPath] ?? files["word/document.xml"];
  if (!docBytes) throw new ImportError("missing-document", "The file has no word/document.xml, so it is not a Word document.");

  const docXml = parseXml(docBytes, "word/document.xml");
  const body = child(docXml.find((n) => tagOf(n) === "document") ?? {}, "body");
  if (!body) throw new ImportError("missing-document", "word/document.xml has no document body.");

  const notes = collectNotes(files);

  const ctx: DCtx = {
    warn,
    assets: new AssetRegistry(),
    rels: parseRels(files["word/_rels/document.xml.rels"], "word/_rels/document.xml.rels"),
    styles: files["word/styles.xml"] ? parseStyles(parseXml(files["word/styles.xml"], "word/styles.xml")) : new Map(),
    numbering: files["word/numbering.xml"] ? parseNumbering(parseXml(files["word/numbering.xml"], "word/numbering.xml")) : { nums: new Map(), abstracts: new Map() },
    files,
    notes,
    commentRefs: 0,
  };

  const builder = new BodyBuilder(ctx, Math.min(opts.maxNestingDepth ?? 32, 8));
  builder.walk(kids(body));
  builder.flush();

  // comments, headers and footers live in other parts: report them so nothing disappears silently
  let comments = ctx.commentRefs;
  if (files["word/comments.xml"]) {
    const root = parseXml(files["word/comments.xml"], "word/comments.xml").find((n) => tagOf(n) === "comments");
    comments = Math.max(comments, root ? childrenNamed(root, "comment").length : 0);
  }
  if (comments > 0) warn.tally("comments", "warning", `The file has ${comments} comment(s); comments are not imported.`);
  const hf: string[] = [];
  for (const name of Object.keys(files)) {
    if (!/^word\/(header|footer)\d*\.xml$/.test(name)) continue;
    const root = parseXml(files[name]!, name)[0];
    const text = root ? rawText(root).trim() : "";
    if (text) hf.push(text);
  }
  if (hf.length) {
    for (const t of hf) warn.tally("header-footer", "warning", "Headers and footers are not imported.", t);
  }

  const chapters = splitChapters(builder.out, opts, warn);
  return { chapters, warnings: warn.list(), assets: ctx.assets.assets };
}
