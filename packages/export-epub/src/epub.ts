import { zipSync, strToU8 } from "fflate";
import {
  dropLeadingPageBreak,
  imageMediaType,
  isAssetPath,
  isBackMatterKind,
  isFrontMatterKind,
  isValidEntryId,
  textDirection,
  type BookMetadata,
  type EntryKind,
  type ChapterDoc,
  type MatterKind,
  type Section,
} from "@cadabracraft/shared";
import { contentsHeading, coverLabel } from "./strings";
import { EpubExportError } from "./errors";
import { contentsList, listedItems, type ContentsItem } from "./contents";
import { COVER_PAGE, navBody, packageOpf, xmlHead, type Cover } from "./package";
import { chapterToXhtmlBody, collectImageSources, esc, headingAnchor } from "./xhtml";

export type { ContentsItem } from "./contents";

/**
 * The author's alignment of a paragraph or heading (`class="align-start|center|end"`). Added to the built-in stylesheet and to a
 * template's, after it: an aligned paragraph is ragged (a centred, justified line has no meaning) and has no first-line indent or
 * drop cap, which is how the PDF sets it.
 */
export const ALIGN_CSS = `.align-start{text-align:start;text-indent:0}.align-center{text-align:center;text-indent:0}.align-end{text-align:end;text-indent:0}
body.chapter.dropcap h1+p.align-start::first-letter,body.chapter.dropcap h1+p.align-center::first-letter,body.chapter.dropcap h1+p.align-end::first-letter{float:none;font-size:inherit;line-height:inherit;padding:0}`;

const CSS = `body{font-family:serif;line-height:1.4}
h1,h2,h3{font-family:sans-serif;page-break-after:avoid}
p{margin:0;text-indent:1.2em}h1+p,h2+p,h3+p,hr+p{text-indent:0}
blockquote{margin:1em 2em;font-style:italic}
hr.scene-break{border:0;text-align:center;margin:1.5em 0}hr.scene-break:after{content:"* * *"}
hr.page-break{border:0;margin:0;page-break-after:always;break-after:page}
.small-caps{font-variant:small-caps}.underline{text-decoration:underline}
a.noteref{font-size:.75em;vertical-align:super}
nav.contents ol{list-style:none;padding-left:1.2em}nav.contents>ol{padding-left:0}
ul.task-list{list-style:none;padding-left:0}ul.task-list ul.task-list{padding-left:1.5em}li.task-item p,dd p{text-indent:0}
dt{font-weight:bold;margin-top:.6em}dd{margin:0 0 .3em 2em}
img{max-width:100%}
body.title-page,body.dedication,body.epigraph{text-align:center}body.copyright p,body.title-page p,body.dedication p,body.epigraph p{text-indent:0}
body.title-page h1{margin:0 0 .5em}body.dedication p{font-style:italic}body.copyright{font-size:.85em}
body.vcenter{margin-top:25%}body.title-page.vcenter{margin-top:30%}
@supports (display:flex){body.vcenter,body.title-page.vcenter{display:flex;flex-direction:column;justify-content:center;min-height:90vh;margin-top:0}}`;

const CONTENTS_HEADING_ID = "contents-title";

export interface EpubChapter {
  id: string;
  title: string;
  doc: ChapterDoc;
  /** Where the page sits in the book; default "chapter". Pass pages in reading order: front matter, chapters, back matter. */
  section?: Section;
  /** Front/back matter pages only. */
  kind?: EntryKind;
  /** Chapters only: a big first letter on this chapter's opening paragraph, the author's choice. Absent follows `BuildOptions.dropCap`. */
  dropCap?: boolean;
  /** Front and back matter pages only: the author's choice to sit the page's content in the vertical middle (true) or at the top (false). Absent follows `BuildOptions.centerKinds`. */
  verticalCenter?: boolean;
}

const FRONT_TYPES: Partial<Record<MatterKind, string>> = {
  "title-page": "titlepage",
  copyright: "copyright-page",
  dedication: "dedication",
  epigraph: "epigraph",
  foreword: "foreword",
  preface: "preface",
};
const BACK_TYPES: Partial<Record<MatterKind, string>> = {
  acknowledgments: "acknowledgments",
  colophon: "colophon",
};

/** Ids that the package itself uses for its own files and manifest items. */
const RESERVED_IDS = new Set(["nav", "css", COVER_PAGE, "epub-cover-image"]);

/** Chapter ids become file names and XML ids, so they must be plain, unique and not clash with the package's own items. */
function checkIds(chapters: EpubChapter[]): void {
  const seen = new Set<string>();
  for (const c of chapters) {
    const where = { chapter: { id: c.id, title: c.title } };
    if (!isValidEntryId(c.id))
      throw new EpubExportError(
        "invalid-id",
        `Page id ${JSON.stringify(c.id)} is not allowed (start with a letter; use letters, digits, "-" and "_")`,
        where,
      );
    if (RESERVED_IDS.has(c.id) || /^img-asset-\d+$/.test(c.id) || seen.has(c.id))
      throw new EpubExportError(
        "invalid-id",
        `Page id "${c.id}" is reserved or used more than once`,
        where,
      );
    seen.add(c.id);
  }
}

/** What in an SVG could run code or fetch something: scripts, event handlers, foreign content, external references, doctypes. */
const SVG_ACTIVE =
  /<script|<foreignObject|<iframe|<embed|<object|<!DOCTYPE|<!ENTITY|<\?xml-stylesheet|\bon[a-z]+\s*=|javascript:|\b(?:xlink:)?href\s*=\s*["']?\s*(?!#|data:image\/(?:png|jpe?g|gif|webp)[;,])[^"'\s>]|@import|url\(\s*["']?\s*(?!#)[^)"'\s]/i;

function checkSvg(src: string, bytes: Uint8Array, where: EpubExportError["where"]): void {
  if (SVG_ACTIVE.test(new TextDecoder("utf-8").decode(bytes)))
    throw new EpubExportError(
      "unsupported-image",
      `The SVG image ${src} contains scripts, event handlers or external references, which are not allowed in an EPUB. Use a PNG or JPEG instead.`,
      where,
    );
}

function checkSection(c: EpubChapter): Section {
  const section = c.section ?? "chapter";
  const ok =
    c.kind === undefined || c.kind === "part"
      ? true
      : section === "front"
        ? isFrontMatterKind(c.kind)
        : section === "back" && isBackMatterKind(c.kind);
  if (!ok)
    throw new EpubExportError(
      "invalid-section",
      `Page "${c.id}": kind "${String(c.kind)}" is not allowed in the ${section} section`,
      { chapter: { id: c.id, title: c.title } },
    );
  return section;
}

/** `epub:type` for the page body and the class stylesheets can use. */
function semantics(c: EpubChapter): { type: string; cls: string } {
  const section = checkSection(c);
  if (c.kind === "part") return { type: "bodymatter part", cls: "part-page" };
  if (section === "chapter") return { type: "bodymatter chapter", cls: "chapter" };
  const kind = c.kind ?? "custom";
  const map = section === "front" ? FRONT_TYPES : BACK_TYPES;
  const extra = map[kind];
  return {
    type: `${section === "front" ? "frontmatter" : "backmatter"}${extra ? ` ${extra}` : ""}`,
    cls: kind,
  };
}

export interface BuildOptions {
  /** Bytes of every image the chapters reference, keyed by the project-relative path stored in the chapter (`assets/a.png`). */
  assets?: ReadonlyMap<string, Uint8Array>;
  /** Stylesheet to use instead of the built-in default, e.g. a template's `epub.css`. */
  css?: string;
  /** Whether chapters with no `dropCap` of their own get a big first letter (the template's choice). The stylesheet draws it for a chapter body with the class `dropcap`. Default false. */
  dropCap?: boolean;
  /** Matter kinds that sit in the vertical middle when the page has no `verticalCenter` of its own (the template's choice, `print.matter.verticalCenter`). The page body gets the class `vcenter`, which the stylesheet centres (see `openingCss` and the default stylesheet). Default none. */
  centerKinds?: readonly MatterKind[];
  /** The cover image: `path` is the project-relative `assets/<name>` (png, jpg or webp) and `bytes` its contents. Adds a cover page first in the reading order, the `cover-image` manifest property and a cover landmark. */
  cover?: { path: string; bytes: Uint8Array };
  /**
   * The book's contents list, already resolved for this book's language (see `ContentsItem`). Given, it is written as a nested
   * list on the page of kind "contents" (if the book has one) and the navigation document is built from the same list, so renames,
   * hidden entries, order and custom entries apply to both. Every heading gets an `id` so entries can link to it. No page numbers
   * (a reflowable book has none). Not given: the navigation lists the pages as before and a contents page shows only its own text.
   */
  contents?: readonly ContentsItem[];
}

/** Builds an EPUB3 package as bytes. Output is deterministic for a given input. Throws an `EpubExportError` (naming the page and the place in it) for an unknown node or mark, a malformed table, a heading level outside 1-3, a nested footnote, an XML-illegal character, an invalid or duplicate page id, or a referenced image that is not an allowed `assets/` image or has no bytes. */
type PageFn = (title: string, body: string, bodyAttrs?: string) => string;

/** Wraps a body in the XHTML document every page of the book shares. */
function pageWrapper(language: string): PageFn {
  const lang = esc(language);
  const dir = textDirection(language) === "rtl" ? ' dir="rtl"' : "";
  return (title, body, bodyAttrs = "") =>
    `${xmlHead}<!DOCTYPE html>\n<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="${lang}" xml:lang="${lang}"${dir}><head><meta charset="utf-8"/><title>${esc(title)}</title><link rel="stylesheet" type="text/css" href="style.css"/></head><body${bodyAttrs}>${body}</body></html>`;
}

/** The media type of the cover image; throws when it is not an allowed `assets/` png, jpg or webp. */
function coverMediaType(cover: Cover | undefined): string | null {
  if (!cover) return null;
  const type = isAssetPath(cover.path) ? imageMediaType(cover.path) : null;
  if (!type || type === "image/gif" || type === "image/svg+xml")
    throw new EpubExportError("unsupported-cover", `Unsupported cover image: ${cover.path}`);
  return type;
}

/** Adds the image files the chapters use (not the cover) to `files`; returns their manifest items and paths. */
function addImages(
  files: Record<string, Uint8Array | [Uint8Array, { level: 0 }]>,
  chapters: EpubChapter[],
  cover: Cover | undefined,
  assets: ReadonlyMap<string, Uint8Array> | undefined,
): { items: string[]; paths: string[] } {
  // A chapter may use the cover file too; it is one file and one manifest item.
  const owners = new Map<string, EpubChapter>();
  for (const c of chapters)
    for (const src of collectImageSources(c.doc))
      if (src !== cover?.path && !owners.has(src)) owners.set(src, c);
  const items = [...owners].map(([src, owner], i) => {
    const type = isAssetPath(src) ? imageMediaType(src) : null;
    const where = { chapter: { id: owner.id, title: owner.title }, nodeType: "image" };
    if (!type)
      throw new EpubExportError(
        "unsupported-image",
        `Unsupported image source in chapter: ${src}`,
        where,
      );
    const bytes = assets?.get(src);
    if (!bytes) throw new EpubExportError("missing-image", `Missing image file for ${src}`, where);
    if (type === "image/svg+xml") checkSvg(src, bytes, where);
    files[`OEBPS/${src}`] = bytes;
    return `<item id="img-asset-${i + 1}" href="${esc(src)}" media-type="${type}"/>`;
  });
  return { items, paths: [...owners.keys()] };
}

function coverPage(meta: BookMetadata, cover: Cover, page: PageFn): string {
  const alt = `${coverLabel(meta.language)}: ${meta.title}`;
  return page(
    alt,
    `<section epub:type="cover"><img role="doc-cover" src="${esc(cover.path)}" alt="${esc(alt)}" style="max-width:100%;max-height:100%"/></section>`,
    ' epub:type="cover" class="cover" style="margin:0;text-align:center"',
  );
}

/** The class of a page body: the semantic class, plus a drop cap or vertical centring when asked for. */
function bodyClass(c: EpubChapter, base: string, options: BuildOptions): string {
  const centred =
    c.kind !== undefined &&
    c.kind !== "part" &&
    (c.verticalCenter ?? options.centerKinds?.includes(c.kind) ?? false);
  if (base === "chapter" && (c.dropCap ?? options.dropCap ?? false)) return "chapter dropcap";
  return centred ? `${base} vcenter` : base;
}

interface PageContext {
  meta: BookMetadata;
  options: BuildOptions;
  shown: readonly ContentsItem[] | undefined;
  known: ReadonlySet<string>;
  page: PageFn;
}

/** One chapter or matter page as an XHTML document. */
function chapterPage(c: EpubChapter, pc: PageContext): string {
  const { meta, options, shown, known, page } = pc;
  const { type, cls: base } = semantics(c);
  // A break as the page's first block asks for nothing (the page is a document of its own, already at the top); kept, it would draw
  // a break at the top of the page.
  const { doc } = dropLeadingPageBreak(c.doc);
  const cls = bodyClass(c, base, options);
  let body: string;
  try {
    body = chapterToXhtmlBody(doc, {
      headingIds: shown !== undefined,
      language: meta.language,
    });
  } catch (e) {
    throw e instanceof EpubExportError ? e.inChapter({ id: c.id, title: c.title }) : e;
  }
  if (shown !== undefined && c.kind === "contents") {
    const own = doc.content.some((n) => n.type === "heading");
    // The page's first heading carries id h-0 (headingIds); a generated one gets its own id. The nav is named by it (aria-labelledby).
    const heading = own
      ? ""
      : `<h1 id="${CONTENTS_HEADING_ID}">${esc(contentsHeading(meta.language))}</h1>`;
    const label = own ? headingAnchor(0) : CONTENTS_HEADING_ID;
    body = `${heading}${body}${shown.length > 0 ? `<nav epub:type="toc" role="doc-toc" class="contents" aria-labelledby="${label}">${contentsList(shown, known)}</nav>` : ""}`;
  }
  return page(c.title, body, ` epub:type="${type}" class="${cls}"`);
}

export function buildEpub(
  meta: BookMetadata,
  chapters: EpubChapter[],
  options: BuildOptions = {},
): Uint8Array {
  // A blank page the author added has nothing to reflow: an e-reader has no pages to leave empty, so it is left out.
  chapters = chapters.filter((c) => c.kind !== "blank");
  checkIds(chapters);
  const page = pageWrapper(meta.language);

  const files: Record<string, Uint8Array | [Uint8Array, { level: 0 }]> = {};
  // mimetype must be first and stored uncompressed.
  files["mimetype"] = [strToU8("application/epub+zip"), { level: 0 }];
  files["META-INF/container.xml"] = strToU8(
    `${xmlHead}<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`,
  );
  files["OEBPS/style.css"] = strToU8(`${options.css ?? CSS}\n${ALIGN_CSS}`);
  // Images keep their relative `assets/<name>` path inside OEBPS, so chapter srcs need no rewriting.
  const cover = options.cover;
  const coverType = coverMediaType(cover);
  if (cover) files[`OEBPS/${cover.path}`] = cover.bytes;
  const images = addImages(files, chapters, cover, options.assets);
  if (cover) files[`OEBPS/${COVER_PAGE}.xhtml`] = strToU8(coverPage(meta, cover, page));
  const shown = options.contents === undefined ? undefined : listedItems(options.contents);
  const known = new Set(chapters.map((c) => c.id));
  const pc: PageContext = { meta, options, shown, known, page };
  for (const c of chapters) files[`OEBPS/${c.id}.xhtml`] = strToU8(chapterPage(c, pc));
  files["OEBPS/nav.xhtml"] = strToU8(
    page(meta.title, navBody(meta, chapters, shown, known, cover)),
  );
  files["OEBPS/content.opf"] = strToU8(
    packageOpf({
      meta,
      chapters,
      cover,
      coverType,
      imageItems: images.items,
      imagePaths: images.paths,
    }),
  );

  return zipSync(files as never, { mtime: new Date(Date.UTC(2020, 0, 1)) });
}
