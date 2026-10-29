import { getSchema } from "@tiptap/core";
import { Node } from "@tiptap/pm/model";
import { extensions } from "@cadabracraft/editor-schema";
import { strToU8, zipSync } from "fflate";
import { expect } from "vitest";
import type { ImportResult } from "..";

export const schema = getSchema(extensions);

/** Every chapter doc must be valid in the real editor schema. */
export function expectValid(result: ImportResult): void {
  for (const ch of result.chapters) {
    const node = Node.fromJSON(schema, ch.doc);
    expect(() => node.check()).not.toThrow();
  }
}

const NS =
  'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006"';

export interface DocxParts {
  body: string;
  styles?: string;
  footnotes?: string;
  endnotes?: string;
  numbering?: string;
  comments?: string;
  header?: string;
  rels?: string;
  media?: Record<string, Uint8Array>;
  extra?: Record<string, Uint8Array>;
}

export const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles ${NS}>
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>
<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/></w:style>
<w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/></w:style>
<w:style w:type="paragraph" w:styleId="Heading3"><w:name w:val="heading 3"/><w:basedOn w:val="Normal"/></w:style>
<w:style w:type="paragraph" w:styleId="Heading4"><w:name w:val="heading 4"/><w:basedOn w:val="Normal"/></w:style>
<w:style w:type="paragraph" w:styleId="Quote"><w:name w:val="Quote"/><w:basedOn w:val="Normal"/></w:style>
<w:style w:type="paragraph" w:styleId="ListBullet"><w:name w:val="List Bullet"/><w:basedOn w:val="Normal"/></w:style>
<w:style w:type="paragraph" w:styleId="ListNumber"><w:name w:val="List Number"/><w:basedOn w:val="Normal"/></w:style>
<w:style w:type="paragraph" w:styleId="MyChapter"><w:name w:val="My Chapter"/><w:basedOn w:val="Heading1"/></w:style>
<w:style w:type="paragraph" w:styleId="SourceCode"><w:name w:val="Source Code"/><w:basedOn w:val="Normal"/></w:style>
<w:style w:type="paragraph" w:styleId="MyCode"><w:name w:val="My Listing"/><w:basedOn w:val="SourceCode"/></w:style>
<w:style w:type="paragraph" w:styleId="Weird"><w:name w:val="Weird Style"/></w:style>
<w:style w:type="character" w:styleId="Hyperlink"><w:name w:val="Hyperlink"/><w:rPr><w:u w:val="single"/></w:rPr></w:style>
<w:style w:type="character" w:styleId="Strong"><w:name w:val="Strong"/><w:rPr><w:b/></w:rPr></w:style>
</w:styles>`;

export const NUMBERING = `<?xml version="1.0"?><w:numbering ${NS}>
<w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0"><w:numFmt w:val="bullet"/></w:lvl><w:lvl w:ilvl="1"><w:numFmt w:val="bullet"/></w:lvl></w:abstractNum>
<w:abstractNum w:abstractNumId="1"><w:lvl w:ilvl="0"><w:numFmt w:val="decimal"/></w:lvl><w:lvl w:ilvl="1"><w:numFmt w:val="lowerLetter"/></w:lvl></w:abstractNum>
<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>
<w:num w:numId="2"><w:abstractNumId w:val="1"/></w:num>
</w:numbering>`;

export function makeDocx(p: DocxParts): Uint8Array {
  const files: Record<string, Uint8Array> = {
    "[Content_Types].xml": strToU8(
      '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
    ),
    "_rels/.rels": strToU8(
      '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
    ),
    "word/document.xml": strToU8(
      `<?xml version="1.0" encoding="UTF-8"?><w:document ${NS}><w:body>${p.body}<w:sectPr/></w:body></w:document>`,
    ),
    "word/styles.xml": strToU8(p.styles ?? STYLES),
    "word/_rels/document.xml.rels": strToU8(
      `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${p.rels ?? ""}</Relationships>`,
    ),
  };
  if (p.footnotes !== undefined)
    files["word/footnotes.xml"] = strToU8(
      `<?xml version="1.0"?><w:footnotes ${NS}>${p.footnotes}</w:footnotes>`,
    );
  if (p.endnotes !== undefined)
    files["word/endnotes.xml"] = strToU8(
      `<?xml version="1.0"?><w:endnotes ${NS}>${p.endnotes}</w:endnotes>`,
    );
  if (p.numbering !== undefined) files["word/numbering.xml"] = strToU8(p.numbering);
  if (p.comments !== undefined)
    files["word/comments.xml"] = strToU8(
      `<?xml version="1.0"?><w:comments ${NS}>${p.comments}</w:comments>`,
    );
  if (p.header !== undefined)
    files["word/header1.xml"] = strToU8(`<?xml version="1.0"?><w:hdr ${NS}>${p.header}</w:hdr>`);
  for (const [k, v] of Object.entries(p.media ?? {})) files[`word/media/${k}`] = v;
  Object.assign(files, p.extra ?? {});
  return zipSync(files);
}

export const para = (text: string, style?: string, ppr = "") =>
  `<w:p><w:pPr>${style ? `<w:pStyle w:val="${style}"/>` : ""}${ppr}</w:pPr><w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;
export const run = (text: string, rpr = "") =>
  `<w:r><w:rPr>${rpr}</w:rPr><w:t xml:space="preserve">${text}</w:t></w:r>`;

// Smallest valid 1x1 PNG.
export const PNG = Uint8Array.from(
  atob(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  )
    .split("")
    .map((c) => c.charCodeAt(0)),
);

/**
 * Wall-clock budget for performance tests. v8 coverage instrumentation makes the hostile-input
 * tests several times slower, so the budget is scaled up when coverage is collecting. Shared CI runners
 * (macOS, Windows) run several jobs at once and measured 17% over a 5 s budget (and 8% over a doubled 10 s one), so it is quadrupled there.
 */
export function budget(ms: number): number {
  const worker = (
    globalThis as { __vitest_worker__?: { config?: { coverage?: { enabled?: boolean } } } }
  ).__vitest_worker__;
  return ms * (worker?.config?.coverage?.enabled ? 5 : 1) * (process.env.CI ? 4 : 1);
}
