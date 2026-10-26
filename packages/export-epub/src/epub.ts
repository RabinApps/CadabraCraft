import { zipSync, strToU8 } from "fflate";
import { textDirection, type BookMetadata, type ChapterDoc } from "@cadabracraft/shared";
import { contentsHeading } from "./strings";
import { chapterToXhtmlBody, esc } from "./xhtml";

const CSS = `body{font-family:serif;line-height:1.4}
h1,h2,h3{font-family:sans-serif;page-break-after:avoid}
p{margin:0;text-indent:1.2em}h1+p,h2+p,h3+p,hr+p{text-indent:0}
blockquote{margin:1em 2em;font-style:italic}
hr.scene-break{border:0;text-align:center;margin:1.5em 0}hr.scene-break:after{content:"* * *"}
.small-caps{font-variant:small-caps}.underline{text-decoration:underline}
a.noteref{font-size:.75em;vertical-align:super}
img{max-width:100%}`;

const xmlHead = '<?xml version="1.0" encoding="UTF-8"?>\n';

export interface EpubChapter {
  id: string;
  title: string;
  doc: ChapterDoc;
}

function isoNoMs(d: Date): string {
  return d.toISOString().replace(/\.\d{3}Z$/, "Z");
}

/** Builds an EPUB3 package as bytes. Output is deterministic for a given input. */
export function buildEpub(meta: BookMetadata, chapters: EpubChapter[]): Uint8Array {
  const lang = esc(meta.language);
  const rtl = textDirection(meta.language) === "rtl";
  const dir = rtl ? ' dir="rtl"' : "";
  const page = (title: string, body: string) =>
    `${xmlHead}<!DOCTYPE html>\n<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="${lang}" xml:lang="${lang}"${dir}><head><meta charset="utf-8"/><title>${esc(title)}</title><link rel="stylesheet" type="text/css" href="style.css"/></head><body>${body}</body></html>`;

  const files: Record<string, Uint8Array | [Uint8Array, { level: 0 }]> = {};
  // mimetype must be first and stored uncompressed.
  files["mimetype"] = [strToU8("application/epub+zip"), { level: 0 }];
  files["META-INF/container.xml"] = strToU8(
    `${xmlHead}<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`,
  );
  files["OEBPS/style.css"] = strToU8(CSS);
  for (const c of chapters) files[`OEBPS/${c.id}.xhtml`] = strToU8(page(c.title, chapterToXhtmlBody(c.doc)));

  const toc = chapters.map((c) => `<li><a href="${c.id}.xhtml">${esc(c.title)}</a></li>`).join("");
  files["OEBPS/nav.xhtml"] = strToU8(
    page(meta.title, `<nav epub:type="toc" id="toc"><h1>${esc(contentsHeading(meta.language))}</h1><ol>${toc}</ol></nav>`),
  );

  const manifest = chapters
    .map((c) => `<item id="${c.id}" href="${c.id}.xhtml" media-type="application/xhtml+xml"/>`)
    .join("");
  const spine = chapters.map((c) => `<itemref idref="${c.id}"/>`).join("");
  files["OEBPS/content.opf"] = strToU8(
    `${xmlHead}<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid" xml:lang="${lang}"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="bookid">${esc(meta.identifier)}</dc:identifier><dc:title>${esc(meta.title)}</dc:title><dc:creator>${esc(meta.author)}</dc:creator><dc:language>${lang}</dc:language><meta property="dcterms:modified">${isoNoMs(meta.modified)}</meta></metadata><manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/><item id="css" href="style.css" media-type="text/css"/>${manifest}</manifest><spine${rtl ? ' page-progression-direction="rtl"' : ""}>${spine}</spine></package>`,
  );

  return zipSync(files as never, { mtime: new Date(Date.UTC(2020, 0, 1)) });
}
