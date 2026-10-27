import { isBackMatterKind, isFrontMatterKind, type DocNode, type Mark, type MatterKind, type Section } from "@cadabracraft/shared";
import { DEFAULT_TEMPLATE_ID, getTemplate, type PrintHeadingStyle, type Template } from "@cadabracraft/templates";
import { escapeMarkup, typstString } from "./escape";
import { FontNotAvailableError, MissingAssetError, PdfExportError } from "./errors";
import {
  TRIM_SIZES,
  type FontChoice,
  type PdfBook,
  type PdfChapter,
  type PdfMargins,
  type PdfOptions,
  type TypstDocument,
} from "./types";

const IMAGE_EXT = new Set(["png", "jpg", "jpeg", "gif", "svg", "webp"]);
const SAFE_LINK = /^(https?:|mailto:)/i;

const num = (n: number): string => String(Math.round(n * 1000) / 1000);
const em = (n: number): string => `${num(n)}em`;
const inch = (n: number): string => `${num(n)}in`;

export function resolveTemplate(options: PdfOptions): Template {
  const t = options.template ?? DEFAULT_TEMPLATE_ID;
  return typeof t === "string" ? getTemplate(t) : t;
}

/** Families a render needs, for the availability check. */
export function requestedFonts(options: PdfOptions): { body: string[]; heading: string[] } {
  const p = resolveTemplate(options).print;
  const body = options.fonts?.body ? [options.fonts.body] : p.bodyFonts;
  const heading = options.fonts?.heading ? [options.fonts.heading] : p.headingFonts.length ? p.headingFonts : body;
  return { body, heading };
}

/**
 * Pick the font families. With `available` (installed family names) the first available candidate wins and
 * a request with no available family throws `FontNotAvailableError`. Without it, the first candidate is used.
 */
export function resolveFonts(options: PdfOptions, available?: Iterable<string>): FontChoice {
  const req = requestedFonts(options);
  if (!available) return { body: req.body[0]!, heading: req.heading[0]! };
  const have = new Set([...available].map((f) => f.toLowerCase()));
  const pick = (families: string[], role: "body" | "heading"): string => {
    const hit = families.find((f) => have.has(f.toLowerCase()));
    if (!hit) throw new FontNotAvailableError(families, role);
    return hit;
  };
  return { body: pick(req.body, "body"), heading: pick(req.heading, "heading") };
}

function resolveMargins(options: PdfOptions, t: Template): PdfMargins {
  const m = { ...t.print.defaults.marginsIn, ...options.margins };
  for (const [k, v] of Object.entries(m)) {
    if (typeof v !== "number" || !Number.isFinite(v) || v < 0.2 || v > 3) throw new PdfExportError(`Invalid ${k} margin: ${v}`);
  }
  return m;
}

// ---- inline ---------------------------------------------------------------------------------------

interface Ctx {
  images: Map<string, string>;
  /** Max image height in inches. */
  maxImageIn: number;
  assets: Record<string, Uint8Array> | undefined;
}

const unsupported = (type: string): never => {
  throw new PdfExportError(`Unsupported node type in chapter: ${type}`);
};

function wrapMark(content: string, m: Mark): string {
  switch (m.type) {
    case "bold": return `#strong[${content}]`;
    case "italic": return `#emph[${content}]`;
    case "underline": return `#underline[${content}]`;
    case "smallCaps": return `#smallcaps[${content}]`;
    case "strike": return `#strike[${content}]`;
    case "superscript": return `#super[${content}]`;
    case "subscript": return `#sub[${content}]`;
    // Inline code is emitted as a raw string by `inline`, which has the unescaped text.
    case "code": return content;
    case "link": {
      const href = m.attrs?.href?.trim() ?? "";
      // Anything but http(s)/mailto keeps its text and loses the link.
      return SAFE_LINK.test(href) ? `#link(${typstString(href)})[${content}]` : content;
    }
    default: return unsupported(`mark:${String((m as { type: unknown }).type)}`);
  }
}

/** Inline content. `lineStart` says the first text begins a line (list/heading markers are then escaped). */
function inline(nodes: DocNode[] | undefined, ctx: Ctx, lineStart: boolean, inFootnote = false): string {
  let out = "";
  let afterCall = false;
  let atStart = lineStart;
  for (const n of nodes ?? []) {
    if (n.type === "text") {
      if (!n.text) continue;
      const marks = n.marks ?? [];
      if (marks.length === 0) {
        out += escapeMarkup(n.text, { lineStart: atStart, afterCall });
        afterCall = false;
      } else {
        const isCode = marks.some((m) => m.type === "code");
        let s = isCode ? `#raw(${typstString(n.text)})` : escapeMarkup(n.text, { lineStart: true });
        let called = isCode;
        for (const m of marks) {
          const w = wrapMark(s, m);
          called ||= w !== s;
          s = w;
        }
        if (!called) {
          // Only unsafe links: plain text.
          s = escapeMarkup(n.text, { lineStart: atStart, afterCall });
          afterCall = false;
        } else {
          afterCall = true;
        }
        out += s;
      }
      atStart = false;
    } else if (n.type === "footnote") {
      if (inFootnote) throw new PdfExportError("Footnotes cannot be nested");
      const body = (n.content ?? [])
        .map((c) => (c.type === "paragraph" ? inline(c.content, ctx, true, true) : inline([c], ctx, true, true)))
        .join(" ");
      out += `#footnote[${body}]`;
      afterCall = true;
      atStart = false;
    } else {
      unsupported(n.type);
    }
  }
  return out;
}

// ---- blocks ---------------------------------------------------------------------------------------

function imagePath(src: string, ctx: Ctx): string {
  const known = ctx.images.get(src);
  if (known) return known;
  const ext = /\.([A-Za-z0-9]+)(?:[?#].*)?$/.exec(src)?.[1]?.toLowerCase() ?? "";
  if (!IMAGE_EXT.has(ext)) throw new PdfExportError(`Unsupported image type for "${src}" (use png, jpg, gif, svg or webp)`);
  const path = `assets/img-${ctx.images.size + 1}.${ext === "jpeg" ? "jpg" : ext}`;
  ctx.images.set(src, path);
  return path;
}

function listItems(kids: DocNode[] | undefined, ctx: Ctx): string {
  return (kids ?? [])
    .map((li) => {
      if (li.type !== "listItem") return unsupported(li.type);
      return `  [\n${blocks(li.content, ctx)}\n  ]`;
    })
    .join(",\n");
}

function block(n: DocNode, ctx: Ctx): string {
  const kids = "content" in n ? n.content : undefined;
  switch (n.type) {
    case "paragraph": {
      const s = inline(kids, ctx, true);
      return s.trim() === "" ? "" : s;
    }
    case "heading": {
      const level = Math.min(3, Math.max(1, Number(n.attrs?.level ?? 1)));
      return `#heading(level: ${level})[${inline(kids, ctx, true)}]`;
    }
    case "blockquote": return `#quote(block: true)[\n${blocks(kids, ctx)}\n]`;
    case "bulletList": return `#list(\n${listItems(kids, ctx)},\n)`;
    case "orderedList": {
      const start = typeof n.attrs?.start === "number" && Number.isInteger(n.attrs.start) ? `start: ${n.attrs.start}, ` : "";
      return `#enum(${start}\n${listItems(kids, ctx)},\n)`;
    }
    case "codeBlock": {
      const text = (kids ?? []).map((k) => {
        if (k.type !== "text") throw new PdfExportError(`Unsupported node type in code block: ${k.type}`);
        return k.text;
      }).join("");
      return `#raw(block: true, ${typstString(text)})`;
    }
    case "sceneBreak": return "#scene-break()";
    case "image": {
      const a = n.attrs ?? {};
      const src = String(a.src ?? "");
      if (!src) throw new PdfExportError("Image without a source");
      if (ctx.assets && !(src in ctx.assets)) throw new MissingAssetError([src]);
      const path = imagePath(src, ctx);
      const alt = a.alt ? typstString(String(a.alt)) : "none";
      const img = `fit-image(${typstString(path)}, ${alt}, ${inch(ctx.maxImageIn)})`;
      const cap = a.title ? `, caption: [${escapeMarkup(String(a.title), { lineStart: true })}]` : "";
      return `#figure(${img}${cap})`;
    }
    default: return unsupported(n.type);
  }
}

function blocks(nodes: DocNode[] | undefined, ctx: Ctx): string {
  return (nodes ?? []).map((n) => block(n, ctx)).filter((s) => s !== "").join("\n\n");
}

// ---- preamble -------------------------------------------------------------------------------------

function headingRule(level: 1 | 2 | 3, s: PrintHeadingStyle, headingFont: string): string {
  const body = s.smallCaps ? "smallcaps(it.body)" : "it.body";
  const above = level === 1 ? "0pt" : em(s.spaceAboveEm);
  return `#show heading.where(level: ${level}): it => block(width: 100%, above: ${above}, below: ${em(s.spaceBelowEm)}, sticky: true, {
  set align(${s.align})
  set text(font: ${typstString(headingFont)}, size: ${em(s.sizeEm)}, weight: ${s.bold ? '"bold"' : '"regular"'}, style: ${s.italic ? '"italic"' : '"normal"'})
  set par(first-line-indent: 0pt, justify: false, hanging-indent: 0pt)
  ${body}
})`;
}

function preamble(book: PdfBook, t: Template, options: PdfOptions, fonts: FontChoice, margins: PdfMargins, hasFront: boolean): string {
  const p = t.print;
  const trim = TRIM_SIZES[options.trimSize ?? p.defaults.trimSize];
  if (!trim) throw new PdfExportError(`Unknown trim size "${String(options.trimSize)}"`);
  const mirrored = options.mirrored ?? true;
  const pageNumbers = options.pageNumbers ?? true;
  const headers = options.runningHeaders ?? true;
  const size = options.fontSizePt ?? p.fontSizePt;
  if (!(size >= 6 && size <= 24)) throw new PdfExportError(`Invalid font size: ${size}`);
  if (trim.w - margins.inside - margins.outside < 2 || trim.h - margins.top - margins.bottom < 3) {
    throw new PdfExportError("Margins leave too little room for text on this trim size");
  }
  const marginArg = mirrored
    ? `(top: ${inch(margins.top)}, bottom: ${inch(margins.bottom)}, inside: ${inch(margins.inside)}, outside: ${inch(margins.outside)})`
    : `(top: ${inch(margins.top)}, bottom: ${inch(margins.bottom)}, left: ${inch(margins.inside)}, right: ${inch(margins.outside)})`;

  const langMatch = /^([A-Za-z]{2,3})(?:[-_]([A-Za-z]{2})(?![A-Za-z]))?/.exec(book.language ?? "");
  const lang = langMatch ? `, lang: ${typstString(langMatch[1]!.toLowerCase())}${langMatch[2] ? `, region: ${typstString(langMatch[2].toUpperCase())}` : ""}` : "";

  const r = p.runningText;
  const runStyle = `set text(size: ${num(r.sizePt)}pt${r.italic ? ', style: "italic"' : ""})`;
  const run = (c: string): string => (r.smallCaps ? `smallcaps(${c})` : c);
  const indent = p.paragraph.style === "indent";
  const spacing = indent ? p.leadingEm : p.paragraph.spacingEm;
  const q = p.blockQuote;
  const sink = em(p.chapterOpening.sinkEm);
  const startOn = options.chapterStart ?? p.chapterOpening.startOn;
  const label = p.chapterOpening.label;

  const header = headers
    ? `header: context {
    let pg = here().page()
    if is-blank(pg) or pg in chapter-pages() or pg in no-header-pages() { return }
    ${runStyle}
    if calc.odd(pg) { align(right, ${run('state("chapter-title").get()')}) } else { align(left, ${run("book-title")}) }
  }`
    : "header: none";
  const footer = pageNumbers
    ? `footer: context {
    if is-blank(here().page()) or here().page() in no-folio-pages() { return }
    ${runStyle}
    align(center, counter(page).display())
  }`
    : "footer: none";

  return `// Generated by @cadabracraft/export-pdf. Template: ${t.id}. Do not edit by hand.
#let book-title = ${typstString(book.title)}
#set document(title: book-title, author: ${typstString(book.author)})
#let mark(name) = [#metadata(none)#label(name)]
#let chapter-pages() = query(<chapter-start>).map(m => m.location().page())
#let chapter-end-pages() = query(<chapter-end>).map(m => m.location().page())
#let is-blank(pg) = (pg + 1) in chapter-pages() and not (pg in chapter-end-pages()) and not (pg in chapter-pages())
// Pages between a pair of start/end marks (title and copyright pages show no header or number; dedications show no header).
#let marked-pages(a, b) = query(label(a)).map(m => m.location().page()).zip(query(label(b)).map(m => m.location().page())).map(((x, y)) => range(x, y + 1)).flatten()
#let no-folio-pages() = marked-pages("folio-off-start", "folio-off-end")
#let no-header-pages() = no-folio-pages() + marked-pages("header-off-start", "header-off-end")
#set page(width: ${inch(trim.w)}, height: ${inch(trim.h)}, margin: ${marginArg},${hasFront ? ' numbering: "i",' : ""}
  ${header},
  ${footer})
#set text(font: ${typstString(fonts.body)}, size: ${num(size)}pt, hyphenate: ${p.hyphenate}${lang})
#set par(justify: ${p.justify}, leading: ${em(p.leadingEm)}, spacing: ${em(spacing)}, first-line-indent: ${
    indent ? `(amount: ${em(p.paragraph.indentEm)}, all: false)` : "0pt"
  })
${headingRule(1, p.headings[1], fonts.heading)}
${headingRule(2, p.headings[2], fonts.heading)}
${headingRule(3, p.headings[3], fonts.heading)}
#show quote.where(block: true): it => block(width: 100%, above: ${em(q.spaceEm)}, below: ${em(q.spaceEm)}, inset: (left: ${em(q.indentEm)}, right: ${em(q.indentEm)}), ${
    q.ruleLeft ? "stroke: (left: 0.6pt + luma(120)), " : ""
  }{
  set text(size: ${em(q.sizeEm)}, style: ${q.italic ? '"italic"' : '"normal"'})
  set par(first-line-indent: 0pt)
  it.body
})
#show list: set par(first-line-indent: 0pt)
#show enum: set par(first-line-indent: 0pt)
#set list(indent: 0.8em, body-indent: 0.6em)
#set enum(indent: 0.8em, body-indent: 0.6em)
#show raw: set text(size: 0.9em)
#show raw.where(block: true): set par(first-line-indent: 0pt, justify: false)
#show raw.where(block: true): set block(above: 1em, below: 1em, breakable: true)
#show footnote.entry: set text(size: ${em(p.footnoteSizeEm)})
#show footnote.entry: set par(first-line-indent: 0pt, justify: false)
#show figure: set block(above: 1.2em, below: 1.2em)
#show figure.caption: it => text(size: 0.85em, it.body)
#let fit-image(path, alt, max-height) = layout(size => {
  let img = image(path, width: size.width, alt: alt)
  if measure(img).height > max-height { image(path, height: max-height, alt: alt) } else { img }
})
#let scene-break() = align(center, block(above: ${em(p.sceneBreak.spaceEm)}, below: ${em(p.sceneBreak.spaceEm)}, ${typstString(p.sceneBreak.glyph)}))
#let chapter-start(title, n) = {
  pagebreak(weak: true${startOn === "recto" ? ', to: "odd"' : ""})
  mark("chapter-start")
  state("chapter-title").update(title)
  counter(footnote).update(0)
  v(${sink})
${
    label === null
      ? ""
      : `  if n != none {
    align(${p.headings[1].align}, text(size: 0.85em, tracking: 0.12em, upper(${typstString(label)}.replace("{n}", str(n)))))
    v(0.8em)
  }
`
  }}
// Front and back matter pages with their own layout. The marks sit inside the aligned block so they stay on the page they describe.
#let matter-marks(start, end, body) = {
  mark("chapter-start")
  mark(start)
  body
  mark(end)
  mark("chapter-end")
}
#let title-page(body) = {
  pagebreak(weak: true)
  align(center + horizon, matter-marks("folio-off-start", "folio-off-end", {
    show heading: it => block(width: 100%, below: 1em, text(font: ${typstString(fonts.heading)}, size: if it.level == 1 { 1.9em } else { 1.1em }, weight: "bold", it.body))
    set par(first-line-indent: 0pt, justify: false)
    set text(size: 1.25em)
    body
  }))
}
#let copyright-page(body) = {
  pagebreak(weak: true)
  align(bottom, block(width: 100%, matter-marks("folio-off-start", "folio-off-end", {
    set text(size: 0.85em)
    set par(first-line-indent: 0pt, justify: false, spacing: 0.7em)
    body
  })))
}
#let centered-page(body) = {
  pagebreak(weak: true)
  align(center + horizon, block(width: 78%, matter-marks("header-off-start", "header-off-end", {
    set par(first-line-indent: 0pt, justify: false)
    body
  })))
}
`;
}

function sectionOf(c: PdfChapter): Section {
  const section = c.section ?? "chapter";
  const ok = c.kind === undefined ? true : section === "front" ? isFrontMatterKind(c.kind) : section === "back" && isBackMatterKind(c.kind);
  if (!ok) throw new PdfExportError(`Page "${c.id}": kind "${String(c.kind)}" is not allowed in the ${section} section`);
  return section;
}

/** Pages that always open on a right-hand page, and the kinds after which the next page must (so the verso stays blank). */
const ALWAYS_RECTO: readonly (MatterKind | undefined)[] = ["title-page", "dedication", "epigraph"];
const BLANK_VERSO_AFTER: readonly (MatterKind | undefined)[] = ["dedication", "epigraph"];

/**
 * The pages in order. Front matter is numbered in lowercase roman (title and copyright pages show no number), arabic numbering
 * restarts at 1 on a right-hand page at the first page after the front matter, and back matter continues the arabic count.
 */
function bodyOf(pages: PdfChapter[], ctx: Ctx): string {
  const out: string[] = [];
  let chapterNo = 0;
  let sawFront = false;
  let restarted = false;
  let prev: MatterKind | undefined;
  for (const page of pages) {
    const section = sectionOf(page);
    const kind = section === "chapter" ? undefined : (page.kind ?? "custom");
    if (section === "front") sawFront = true;
    const restart = sawFront && section !== "front" && !restarted;
    if (restart) {
      restarted = true;
      out.push('#pagebreak(weak: true, to: "odd")\n#set page(numbering: "1")\n#counter(page).update(1)\n');
    } else if (ALWAYS_RECTO.includes(kind) || BLANK_VERSO_AFTER.includes(prev)) {
      out.push('#pagebreak(weak: true, to: "odd")\n');
    }
    prev = kind;
    const content = blocks(page.doc.content, ctx);
    const title = typstString(page.title);
    switch (kind) {
      case "title-page": out.push(`#title-page[\n${content}\n]\n`); break;
      case "copyright": out.push(`#copyright-page[\n${content}\n]\n`); break;
      case "dedication":
      case "epigraph": out.push(`#centered-page[\n${content}\n]\n`); break;
      case undefined: out.push(`#chapter-start(${title}, ${++chapterNo})\n\n${content}\n\n#mark("chapter-end")\n`); break;
      default: out.push(`#chapter-start(${title}, none)\n\n${content}\n\n#mark("chapter-end")\n`);
    }
  }
  return out.join("\n");
}

/**
 * The cover as a full-bleed first page (no margins, header or number). Chapters and title pages open on right-hand pages, so the cover's
 * back (the inside front cover) stays blank and the book starts on page 3. The counter is set to 0 on that blank page so that page 3 is
 * numbered 1: pages are numbered, and sit on the left or right, exactly as in a book without a cover.
 */
function coverPage(src: string, ctx: Ctx): string {
  if (ctx.assets && !(src in ctx.assets)) throw new MissingAssetError([src]);
  const ext = /\.([A-Za-z0-9]+)$/.exec(src)?.[1]?.toLowerCase() ?? "";
  if (!["png", "jpg", "jpeg", "webp"].includes(ext)) throw new PdfExportError(`Unsupported cover image "${src}" (use png, jpg or webp)`);
  const path = imagePath(src, ctx);
  return `#page(margin: 0pt, header: none, footer: none)[#image(${typstString(path)}, width: 100%, height: 100%, fit: "cover", alt: "Cover")]\n#page(header: none, footer: none)[#counter(page).update(0)]\n\n`;
}

/** Typst document plus the image paths it expects (relative to the compile directory). */
export function buildTypstDocument(
  book: PdfBook,
  chapters: PdfChapter[],
  options: PdfOptions = {},
  fonts?: FontChoice,
): TypstDocument {
  const t = resolveTemplate(options);
  const resolved = fonts ?? resolveFonts(options);
  const margins = resolveMargins(options, t);
  const trim = TRIM_SIZES[options.trimSize ?? t.print.defaults.trimSize];
  if (!trim) throw new PdfExportError(`Unknown trim size "${String(options.trimSize)}"`);
  const ctx: Ctx = {
    images: new Map(),
    maxImageIn: Math.max(1, trim.h - margins.top - margins.bottom - 1),
    assets: options.assets,
  };
  const head = preamble(book, t, options, resolved, margins, chapters.some((c) => (c.section ?? "chapter") === "front"));
  const cover = options.cover === undefined ? "" : coverPage(options.cover, ctx);
  const body = bodyOf(chapters, ctx);
  return { source: `${head}\n${cover}${body}`, images: ctx.images, fonts: resolved };
}

/** Pure: chapter JSON -> Typst source. No I/O, no font availability check (see `renderPdf`). */
export function buildTypst(book: PdfBook, chapters: PdfChapter[], options: PdfOptions = {}): string {
  return buildTypstDocument(book, chapters, options).source;
}
