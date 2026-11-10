import {
  normalizeIsbn,
  textDirection,
  type BookMetadata,
  type Publishing,
} from "@cadabracraft/shared";
import { TOC_UNLISTED_KINDS as UNLISTED } from "@cadabracraft/format";
import { accessibilityMetadata } from "./a11y";
import { contentsList, type ContentsItem } from "./contents";
import { contentsHeading, coverLabel, landmarksHeading, startOfContentLabel } from "./strings";
import { esc, imageAltStats } from "./xhtml";
import { GLOSSARY_PAGE, INDEX_PAGE } from "./generated";
import type { EpubChapter } from "./epub";

export const COVER_PAGE = "epub-cover";
export const xmlHead = '<?xml version="1.0" encoding="UTF-8"?>\n';

export type Cover = { path: string; bytes: Uint8Array };

export const listedInToc = (c: EpubChapter): boolean =>
  c.kind === undefined || c.kind === "part" || !UNLISTED.includes(c.kind);

/**
 * OPF metadata for the retail details: `dc:publisher`, `dc:description`, one `dc:subject` each, `dc:rights`, `dc:date`
 * (publication date) and the series as an EPUB 3 collection with its `group-position`. Unset keys write nothing.
 */
function retailMetadata(p: Publishing | undefined): string {
  if (!p) return "";
  const tag = (name: string, value: string | undefined) =>
    value === undefined ? "" : `<dc:${name}>${esc(value)}</dc:${name}>`;
  const series = p.series
    ? `<meta property="belongs-to-collection" id="series">${esc(p.series)}</meta><meta refines="#series" property="collection-type">series</meta>${
        p.seriesNumber
          ? `<meta refines="#series" property="group-position">${esc(p.seriesNumber)}</meta>`
          : ""
      }`
    : "";
  return (
    tag("publisher", p.publisher) +
    tag("description", p.description) +
    (p.subjects ?? []).map((s) => tag("subject", s)).join("") +
    tag("rights", p.rights) +
    tag("date", p.published) +
    series
  );
}

function isoNoMs(d: Date): string {
  return d.toISOString().replace(/\.\d{3}Z$/, "Z");
}

/** The navigation document's body: the contents list (or the pages) and the landmarks. */
export function navBody(
  meta: BookMetadata,
  chapters: EpubChapter[],
  shown: readonly ContentsItem[] | undefined,
  known: ReadonlySet<string>,
  cover: Cover | undefined,
): string {
  // The contents lists chapters and reading sections; if that leaves nothing (only a title page, say) it lists every page.
  const listed = chapters.filter(listedInToc);
  // The generated index and glossary pages follow the contents list the author arranged.
  const generated = chapters.filter((c) => c.id === INDEX_PAGE || c.id === GLOSSARY_PAGE);
  const extra = generated
    .map((c) => `<li><a href="${c.id}.xhtml">${esc(c.title)}</a></li>`)
    .join("");
  const navList =
    shown !== undefined ? contentsList(shown, known, true).replace(/<\/ol>$/, `${extra}</ol>`) : "";
  const toc =
    navList !== ""
      ? navList
      : `<ol>${(listed.length ? listed : chapters)
          .map((c) => `<li><a href="${c.id}.xhtml">${esc(c.title)}</a></li>`)
          .join("")}</ol>`;
  const start =
    chapters.find((c) => (c.section ?? "chapter") === "chapter") ??
    (listed.length ? listed : chapters)[0];
  const contents = contentsHeading(meta.language);
  const landmarks = `<nav epub:type="landmarks" hidden="hidden"><h2>${esc(landmarksHeading(meta.language))}</h2><ol>${
    cover
      ? `<li><a epub:type="cover" href="${COVER_PAGE}.xhtml">${esc(coverLabel(meta.language))}</a></li>`
      : ""
  }${
    start
      ? `<li><a epub:type="bodymatter" href="${start.id}.xhtml">${esc(startOfContentLabel(meta.language))}</a></li>`
      : ""
  }<li><a epub:type="toc" href="nav.xhtml#toc">${esc(contents)}</a></li>${generated
    .map(
      (c) =>
        `<li><a epub:type="${c.id === INDEX_PAGE ? "index" : "glossary"}" href="${c.id}.xhtml">${esc(c.title)}</a></li>`,
    )
    .join("")}</ol></nav>`;
  return `<nav epub:type="toc" role="doc-toc" id="toc"><h1>${esc(contents)}</h1>${toc}</nav>${landmarks}`;
}

export interface PackageParts {
  meta: BookMetadata;
  chapters: EpubChapter[];
  cover: Cover | undefined;
  coverType: string | null;
  /** Manifest items of the images the chapters use, already built. */
  imageItems: string[];
  /** Paths of the images the chapters use (not the cover). */
  imagePaths: string[];
}

/** The package document (`content.opf`). */
export function packageOpf(parts: PackageParts): string {
  const { meta, chapters, cover, coverType, imageItems, imagePaths } = parts;
  const lang = esc(meta.language);
  const rtl = textDirection(meta.language) === "rtl";
  const manifest = (
    cover
      ? [`<item id="${COVER_PAGE}" href="${COVER_PAGE}.xhtml" media-type="application/xhtml+xml"/>`]
      : []
  )
    .concat(
      chapters.map(
        (c) => `<item id="${c.id}" href="${c.id}.xhtml" media-type="application/xhtml+xml"/>`,
      ),
    )
    .join("");
  // The navigation document is a non-linear spine item: the landmarks link to it, and EPUB requires link targets to be in the spine.
  const spine = [
    ...(cover ? [`<itemref idref="${COVER_PAGE}"/>`] : []),
    ...chapters.map((c) => `<itemref idref="${c.id}"/>`),
    '<itemref idref="nav" linear="no"/>',
  ].join("");
  const isbn = normalizeIsbn(meta.isbn);
  // The unique identifier stays the book's own id; the ISBN is an additional identifier (skipped when it is the id already).
  const isbnUrn =
    isbn && `urn:isbn:${isbn}` !== meta.identifier.trim().toLowerCase()
      ? `<dc:identifier>urn:isbn:${isbn}</dc:identifier>`
      : "";
  const retail = retailMetadata(meta.publishing);
  const stats = chapters.map((c) => imageAltStats(c.doc));
  const a11y = accessibilityMetadata(
    {
      images: stats.reduce((n, s) => n + s.total, 0),
      imagesMissingAlt: stats.reduce((n, s) => n + s.missingAlt, 0),
      hasCover: cover !== undefined,
      hasGif: imagePaths.some((p) => p.toLowerCase().endsWith(".gif")),
      hasSvg: imagePaths.some((p) => p.toLowerCase().endsWith(".svg")),
    },
    meta.language,
  );
  return `${xmlHead}<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid" xml:lang="${lang}"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="bookid">${esc(meta.identifier)}</dc:identifier>${isbnUrn}<dc:title>${esc(meta.title)}</dc:title><dc:creator>${esc(meta.author)}</dc:creator><dc:language>${lang}</dc:language>${retail}<meta property="dcterms:modified">${isoNoMs(meta.modified)}</meta>${a11y}${cover ? '<meta name="cover" content="epub-cover-image"/>' : ""}</metadata><manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/><item id="css" href="style.css" media-type="text/css"/>${manifest}${imageItems.join("")}${cover ? `<item id="epub-cover-image" href="${esc(cover.path)}" media-type="${coverType}" properties="cover-image"/>` : ""}</manifest><spine${rtl ? ' page-progression-direction="rtl"' : ""}>${spine}</spine></package>`;
}
