import { zipSync, strToU8 } from "fflate";
import { imageMediaType, isAssetPath, isBackMatterKind, isFrontMatterKind, textDirection, type BookMetadata, type ChapterDoc, type MatterKind, type Section } from "@cadabracraft/shared";
import { contentsHeading, coverLabel, landmarksHeading, startOfContentLabel } from "./strings";
import { chapterToXhtmlBody, collectImageSources, esc } from "./xhtml";

const CSS = `body{font-family:serif;line-height:1.4}
h1,h2,h3{font-family:sans-serif;page-break-after:avoid}
p{margin:0;text-indent:1.2em}h1+p,h2+p,h3+p,hr+p{text-indent:0}
blockquote{margin:1em 2em;font-style:italic}
hr.scene-break{border:0;text-align:center;margin:1.5em 0}hr.scene-break:after{content:"* * *"}
.small-caps{font-variant:small-caps}.underline{text-decoration:underline}
a.noteref{font-size:.75em;vertical-align:super}
img{max-width:100%}
body.title-page,body.dedication,body.epigraph{text-align:center}body.copyright p,body.title-page p,body.dedication p,body.epigraph p{text-indent:0}
body.dedication,body.epigraph{margin-top:25%}body.dedication p{font-style:italic}body.copyright{font-size:.85em}`;

const xmlHead = '<?xml version="1.0" encoding="UTF-8"?>\n';

export interface EpubChapter {
  id: string;
  title: string;
  doc: ChapterDoc;
  /** Where the page sits in the book; default "chapter". Pass pages in reading order: front matter, chapters, back matter. */
  section?: Section;
  /** Front/back matter pages only. */
  kind?: MatterKind;
}

const FRONT_TYPES: Partial<Record<MatterKind, string>> = {
  "title-page": "titlepage", copyright: "copyright-page", dedication: "dedication", epigraph: "epigraph", foreword: "foreword", preface: "preface",
};
const BACK_TYPES: Partial<Record<MatterKind, string>> = { acknowledgments: "acknowledgments", colophon: "colophon" };
/** Pages the table of contents leaves out: they are not places a reader navigates to. */
const UNLISTED: readonly MatterKind[] = ["title-page", "copyright", "dedication", "epigraph", "colophon"];

function checkSection(c: EpubChapter): Section {
  const section = c.section ?? "chapter";
  const ok = c.kind === undefined ? true : section === "front" ? isFrontMatterKind(c.kind) : section === "back" && isBackMatterKind(c.kind);
  if (!ok) throw new Error(`Page "${c.id}": kind "${String(c.kind)}" is not allowed in the ${section} section`);
  return section;
}

/** `epub:type` for the page body and the class stylesheets can use. */
function semantics(c: EpubChapter): { type: string; cls: string } {
  const section = checkSection(c);
  if (section === "chapter") return { type: "bodymatter chapter", cls: "chapter" };
  const kind = c.kind ?? "custom";
  const map = section === "front" ? FRONT_TYPES : BACK_TYPES;
  const extra = map[kind];
  return { type: `${section === "front" ? "frontmatter" : "backmatter"}${extra ? ` ${extra}` : ""}`, cls: kind };
}

const listedInToc = (c: EpubChapter): boolean => c.kind === undefined || !UNLISTED.includes(c.kind);

function isoNoMs(d: Date): string {
  return d.toISOString().replace(/\.\d{3}Z$/, "Z");
}

export interface BuildOptions {
  /** Bytes of every image the chapters reference, keyed by the project-relative path stored in the chapter (`assets/a.png`). */
  assets?: ReadonlyMap<string, Uint8Array>;
  /** Stylesheet to use instead of the built-in default, e.g. a template's `epub.css`. */
  css?: string;
  /** The cover image: `path` is the project-relative `assets/<name>` (png, jpg or webp) and `bytes` its contents. Adds a cover page first in the reading order, the `cover-image` manifest property and a cover landmark. */
  cover?: { path: string; bytes: Uint8Array };
}

const COVER_PAGE = "epub-cover";

/** Builds an EPUB3 package as bytes. Output is deterministic for a given input. Throws if a referenced image is not an allowed `assets/` image or its bytes are missing. */
export function buildEpub(meta: BookMetadata, chapters: EpubChapter[], options: BuildOptions = {}): Uint8Array {
  const lang = esc(meta.language);
  const rtl = textDirection(meta.language) === "rtl";
  const dir = rtl ? ' dir="rtl"' : "";
  const page = (title: string, body: string, bodyAttrs = "") =>
    `${xmlHead}<!DOCTYPE html>\n<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="${lang}" xml:lang="${lang}"${dir}><head><meta charset="utf-8"/><title>${esc(title)}</title><link rel="stylesheet" type="text/css" href="style.css"/></head><body${bodyAttrs}>${body}</body></html>`;

  const files: Record<string, Uint8Array | [Uint8Array, { level: 0 }]> = {};
  // mimetype must be first and stored uncompressed.
  files["mimetype"] = [strToU8("application/epub+zip"), { level: 0 }];
  files["META-INF/container.xml"] = strToU8(
    `${xmlHead}<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`,
  );
  files["OEBPS/style.css"] = strToU8(options.css ?? CSS);
  // Images keep their relative `assets/<name>` path inside OEBPS, so chapter srcs need no rewriting.
  const cover = options.cover;
  const coverType = cover ? (isAssetPath(cover.path) ? imageMediaType(cover.path) : null) : null;
  if (cover && (!coverType || coverType === "image/gif" || coverType === "image/svg+xml")) throw new Error(`Unsupported cover image: ${cover.path}`);
  if (cover) files[`OEBPS/${cover.path}`] = cover.bytes;
  // A chapter may use the cover file too; it is one file and one manifest item.
  const imagePaths = [...new Set(chapters.flatMap((c) => collectImageSources(c.doc)))].filter((src) => src !== cover?.path);
  const imageItems = imagePaths.map((src, i) => {
    const type = isAssetPath(src) ? imageMediaType(src) : null;
    if (!type) throw new Error(`Unsupported image source in chapter: ${src}`);
    const bytes = options.assets?.get(src);
    if (!bytes) throw new Error(`Missing image file for ${src}`);
    files[`OEBPS/${src}`] = bytes;
    return `<item id="img-asset-${i + 1}" href="${esc(src)}" media-type="${type}"/>`;
  });
  if (cover) {
    const alt = `${coverLabel(meta.language)}: ${meta.title}`;
    files[`OEBPS/${COVER_PAGE}.xhtml`] = strToU8(
      page(alt, `<section epub:type="cover"><img src="${esc(cover.path)}" alt="${esc(alt)}" style="max-width:100%;max-height:100%"/></section>`, ' epub:type="cover" class="cover" style="margin:0;text-align:center"'),
    );
  }
  for (const c of chapters) {
    const { type, cls } = semantics(c);
    files[`OEBPS/${c.id}.xhtml`] = strToU8(page(c.title, chapterToXhtmlBody(c.doc), ` epub:type="${type}" class="${cls}"`));
  }

  // The contents lists chapters and reading sections; if that leaves nothing (only a title page, say) it lists every page.
  const listed = chapters.filter(listedInToc);
  const toc = (listed.length ? listed : chapters).map((c) => `<li><a href="${c.id}.xhtml">${esc(c.title)}</a></li>`).join("");
  const start = chapters.find((c) => (c.section ?? "chapter") === "chapter") ?? (listed.length ? listed : chapters)[0];
  const contents = contentsHeading(meta.language);
  const landmarks = `<nav epub:type="landmarks" hidden="hidden"><h2>${esc(landmarksHeading(meta.language))}</h2><ol>${
    cover ? `<li><a epub:type="cover" href="${COVER_PAGE}.xhtml">${esc(coverLabel(meta.language))}</a></li>` : ""
  }${
    start ? `<li><a epub:type="bodymatter" href="${start.id}.xhtml">${esc(startOfContentLabel(meta.language))}</a></li>` : ""
  }<li><a epub:type="toc" href="nav.xhtml#toc">${esc(contents)}</a></li></ol></nav>`;
  files["OEBPS/nav.xhtml"] = strToU8(
    page(meta.title, `<nav epub:type="toc" id="toc"><h1>${esc(contents)}</h1><ol>${toc}</ol></nav>${landmarks}`),
  );

  const manifest = (cover ? [`<item id="${COVER_PAGE}" href="${COVER_PAGE}.xhtml" media-type="application/xhtml+xml"/>`] : []).concat(chapters
    .map((c) => `<item id="${c.id}" href="${c.id}.xhtml" media-type="application/xhtml+xml"/>`))
    .join("");
  // The navigation document is a non-linear spine item: the landmarks link to it, and EPUB requires link targets to be in the spine.
  const spine = [...(cover ? [`<itemref idref="${COVER_PAGE}"/>`] : []), ...chapters.map((c) => `<itemref idref="${c.id}"/>`), '<itemref idref="nav" linear="no"/>'].join("");
  files["OEBPS/content.opf"] = strToU8(
    `${xmlHead}<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid" xml:lang="${lang}"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="bookid">${esc(meta.identifier)}</dc:identifier><dc:title>${esc(meta.title)}</dc:title><dc:creator>${esc(meta.author)}</dc:creator><dc:language>${lang}</dc:language><meta property="dcterms:modified">${isoNoMs(meta.modified)}</meta>${cover ? '<meta name="cover" content="epub-cover-image"/>' : ""}</metadata><manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/><item id="css" href="style.css" media-type="text/css"/>${manifest}${imageItems.join("")}${cover ? `<item id="epub-cover-image" href="${esc(cover.path)}" media-type="${coverType}" properties="cover-image"/>` : ""}</manifest><spine${rtl ? ' page-progression-direction="rtl"' : ""}>${spine}</spine></package>`,
  );

  return zipSync(files as never, { mtime: new Date(Date.UTC(2020, 0, 1)) });
}
