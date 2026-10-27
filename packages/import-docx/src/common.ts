import type { ChapterDoc, DocNode, Mark } from "@cadabracraft/shared";
import type { ImportAsset, ImportedChapter, ImportOptions, ImportWarning, WarningSeverity } from "./types";

const MAX_INDIVIDUAL = 25;
const MAX_EXAMPLES = 5;

/** Collects warnings. `at` keeps per-location warnings (capped per code); `tally` aggregates counts and examples. */
export class Warnings {
  private located = new Map<string, { list: ImportWarning[]; extra: number; sev: WarningSeverity }>();
  private tallies = new Map<string, ImportWarning>();
  private order: string[] = [];

  at(code: string, severity: WarningSeverity, message: string, line?: number): void {
    let e = this.located.get(code);
    if (!e) {
      e = { list: [], extra: 0, sev: severity };
      this.located.set(code, e);
      this.order.push(`L:${code}`);
    }
    if (e.list.length < MAX_INDIVIDUAL) e.list.push({ code, severity, message, ...(line ? { line } : {}) });
    else e.extra++;
  }

  tally(code: string, severity: WarningSeverity, message: string, example?: string): void {
    let w = this.tallies.get(code);
    if (!w) {
      w = { code, severity, message, count: 0, examples: [] };
      this.tallies.set(code, w);
      this.order.push(`T:${code}`);
    }
    w.count = (w.count ?? 0) + 1;
    const ex = example?.replace(/\s+/g, " ").trim().slice(0, 80);
    if (ex && w.examples && w.examples.length < MAX_EXAMPLES && !w.examples.includes(ex)) w.examples.push(ex);
  }

  list(): ImportWarning[] {
    const out: ImportWarning[] = [];
    for (const key of this.order) {
      const code = key.slice(2);
      if (key[0] === "L") {
        const e = this.located.get(code)!;
        out.push(...e.list);
        if (e.extra > 0)
          out.push({ code, severity: e.sev, message: `${e.extra} more occurrences of this warning were omitted`, count: e.extra });
      } else {
        const w = { ...this.tallies.get(code)! };
        if (w.examples?.length === 0) delete w.examples;
        out.push(w);
      }
    }
    return out;
  }
}

/** Marks in the editor schema's rank order (ProseMirror requires sorted mark sets). A test checks this against the real schema. */
export const MARK_ORDER: Mark["type"][] = ["link", "bold", "code", "italic", "strike", "underline", "smallCaps", "superscript", "subscript"];

export function sortMarks(marks: Mark[]): Mark[] | undefined {
  const seen = new Set<string>();
  const out: Mark[] = [];
  for (const m of marks) {
    if (seen.has(m.type)) continue;
    seen.add(m.type);
    out.push(m);
  }
  if (out.length === 0) return undefined;
  // Super- and subscript exclude each other in the schema: the innermost (last added) wins.
  const script = marks.filter((m) => m.type === "superscript" || m.type === "subscript").pop();
  if (script) for (let i = out.length - 1; i >= 0; i--) if ((out[i]!.type === "superscript" || out[i]!.type === "subscript") && out[i]!.type !== script.type) out.splice(i, 1);
  // Inline code excludes every other mark in the schema, so it wins over whatever surrounds it.
  const code = out.find((m) => m.type === "code");
  if (code) return [code];
  return out.sort((a, b) => MARK_ORDER.indexOf(a.type) - MARK_ORDER.indexOf(b.type));
}

/**
 * Text that XML 1.0 (EPUB) and UTF-8 files can hold: C0 controls other than tab and newline, U+FFFE/U+FFFF and the BOM-like
 * U+FEFF inside text are removed, and a lone surrogate becomes U+FFFD. NUL, form feed and friends would make the XHTML invalid.
 */
// eslint-disable-next-line no-control-regex
const BAD_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;
export function cleanText(text: string): string {
  return text.replace(BAD_CHARS, (c) => (c >= "\uD800" && c <= "\uDFFF" ? "\uFFFD" : ""));
}

export function textNode(rawText: string, marks: Mark[] = []): DocNode | null {
  const text = cleanText(rawText);
  if (text === "") return null;
  const m = sortMarks(marks);
  return m ? { type: "text", text, marks: m } : { type: "text", text };
}

/** Merge adjacent text nodes with identical marks and drop empty ones. */
export function mergeInline(nodes: DocNode[]): DocNode[] {
  const out: DocNode[] = [];
  for (const n of nodes) {
    if (n.type === "text") {
      if (n.text === "") continue;
      const prev = out[out.length - 1];
      if (prev && prev.type === "text" && JSON.stringify(prev.marks ?? []) === JSON.stringify(n.marks ?? [])) {
        out[out.length - 1] = { ...prev, text: prev.text + n.text };
        continue;
      }
    }
    out.push(n);
  }
  return out;
}

export function plainText(nodes: DocNode[] | undefined): string {
  let s = "";
  for (const n of nodes ?? []) {
    if (n.type === "text") s += n.text;
    else if (n.type !== "footnote") s += plainText(n.content);
  }
  return s;
}

/** Inline content plus the two separators importers use: a manual line break and a block lifted out of a paragraph. */
export type Item = DocNode | { sep: "break" } | { sep: "block"; node: DocNode };
export const isSep = (i: Item): i is Extract<Item, { sep: string }> => "sep" in i;

/** Items as one run of inline nodes: line breaks become a space, lifted blocks are dropped. Adjacent text is merged. */
export function flattenItems(items: Item[]): DocNode[] {
  const nodes: DocNode[] = [];
  for (const i of items) {
    if (!isSep(i)) nodes.push(i);
    else if (i.sep === "break") nodes.push({ type: "text", text: " " });
  }
  return mergeInline(nodes);
}

export function paragraphOf(content: DocNode[]): DocNode {
  const c = mergeInline(content);
  return c.length ? { type: "paragraph", content: c } : { type: "paragraph" };
}

/** Maps source image references to unique project-relative asset paths. */
export class AssetRegistry {
  readonly assets: ImportAsset[] = [];
  private bySource = new Map<string, ImportAsset>();
  private used = new Set<string>();

  register(sourcePath: string, mediaType?: string, bytes?: Uint8Array): ImportAsset {
    const hit = this.bySource.get(sourcePath);
    if (hit) return hit;
    const base = sourcePath.split(/[\\/]/).pop() ?? "";
    let name = base.replace(/[^A-Za-z0-9._-]/g, "_").replace(/^\.+/, "");
    if (!name) name = "image";
    let target = `assets/${name}`;
    for (let i = 2; this.used.has(target.toLowerCase()); i++) {
      const dot = name.lastIndexOf(".");
      target = `assets/${dot > 0 ? `${name.slice(0, dot)}-${i}${name.slice(dot)}` : `${name}-${i}`}`;
    }
    this.used.add(target.toLowerCase());
    const asset: ImportAsset = { sourcePath, targetPath: target, ...(mediaType ? { mediaType } : {}), ...(bytes ? { bytes } : {}) };
    this.bySource.set(sourcePath, asset);
    this.assets.push(asset);
    return asset;
  }
}

export const IMAGE_TYPES: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
};

export function extOf(path: string): string {
  const m = /\.([A-Za-z0-9]+)$/.exec(path);
  return m ? m[1]!.toLowerCase() : "";
}

/** Only http, https and mailto links are kept (same policy as the editor). */
export function safeHref(url: string): string | null {
  const v = url.trim();
  if (!v || /\s/.test(v) || !/^(https?:|mailto:)/i.test(v)) return null;
  try {
    const u = new URL(v);
    return ["http:", "https:", "mailto:"].includes(u.protocol) ? u.href : null;
  } catch {
    return null;
  }
}

export const SCENE_BREAK_TEXT = /^(\*(\s*\*){2,}|#)$/;

/**
 * Splits top-level blocks into chapters on headings of the split level. The heading stays in the chapter doc
 * (matches fixtures/manuscripts). Content before the first heading becomes an "Untitled" chapter.
 */
export function splitChapters(blocks: DocNode[], opts: ImportOptions, warn: Warnings): ImportedChapter[] {
  const level = opts.splitHeadingLevel ?? 1;
  const untitled = opts.untitledTitle ?? "Untitled";
  const chapters: { title: string; content: DocNode[]; pre: boolean }[] = [];
  let cur: { title: string; content: DocNode[]; pre: boolean } | null = null;
  let sawHeading = false;
  for (const b of blocks) {
    if (b.type === "heading" && b.attrs?.level === level) {
      sawHeading = true;
      cur = { title: plainText(b.content).trim() || untitled, content: [b], pre: false };
      chapters.push(cur);
      continue;
    }
    if (!cur) {
      cur = { title: untitled, content: [], pre: true };
      chapters.push(cur);
    }
    cur.content.push(b);
  }
  if (chapters.length === 0) {
    warn.at("empty-input", "warning", "The file contains no importable content.");
  } else if (!sawHeading) {
    warn.at("no-headings", "warning", `No level ${level} headings found, so the whole file is one chapter titled "${untitled}".`);
  } else if (chapters[0]!.pre) {
    warn.at("untitled-content", "warning", `Content before the first level ${level} heading was placed in a chapter titled "${untitled}".`);
  }
  return chapters.map((c) => ({ title: c.title, doc: { type: "doc", content: c.content } as ChapterDoc }));
}

/** Fix a list item's content to satisfy `paragraph block*`. */
export function listItemOf(content: DocNode[]): DocNode {
  const c = content.length && content[0]!.type === "paragraph" ? content : [{ type: "paragraph" } as DocNode, ...content];
  return { type: "listItem", content: c };
}

/** A table cell must hold `paragraph+`: keep paragraphs, flatten any other block to paragraphs, and say whether that changed anything. */
export function cellParagraphs(blocks: DocNode[]): { paragraphs: DocNode[]; flattened: boolean } {
  const paragraphs: DocNode[] = [];
  let flattened = false;
  const kids = (n: DocNode): DocNode[] => ("content" in n ? n.content ?? [] : []);
  const rowText = (row: DocNode): string => kids(row).map((c) => plainText(kids(c).flatMap(kids)).replace(/\s+/g, " ").trim()).join(" | ");
  const walk = (n: DocNode) => {
    switch (n.type) {
      case "paragraph": paragraphs.push(n); break;
      case "heading": flattened = true; paragraphs.push(paragraphOf(n.content ?? [])); break;
      case "bulletList": case "orderedList": case "blockquote": case "listItem": flattened = true; for (const k of n.content ?? []) walk(k); break;
      case "table": {
        flattened = true;
        for (const row of n.content ?? []) {
          const t = rowText(row);
          if (t.replace(/[|\s]/g, "")) paragraphs.push(paragraphOf([{ type: "text", text: t }]));
        }
        break;
      }
      case "codeBlock": flattened = true; if (plainText(n.content)) paragraphs.push(paragraphOf([{ type: "text", text: plainText(n.content) }])); break;
      case "image": flattened = true; if (n.attrs?.alt) paragraphs.push(paragraphOf([{ type: "text", text: String(n.attrs.alt) }])); break;
      default: flattened = true;
    }
  };
  for (const b of blocks) walk(b);
  return { paragraphs: paragraphs.length ? paragraphs : [{ type: "paragraph" }], flattened };
}

/** A rectangular table node from rows of cells (each cell a paragraph list); short rows are padded with empty cells. `null` when there are no cells. */
export function tableOf(rows: DocNode[][][], headerRow: boolean): { node: DocNode | null; padded: boolean } {
  const width = Math.max(0, ...rows.map((r) => r.length));
  if (width === 0) return { node: null, padded: false };
  let padded = false;
  const kept = rows.filter((r) => r.length > 0);
  const content = kept.map((cells, i) => {
    if (cells.length < width) padded = true;
    const full = [...cells, ...Array.from({ length: width - cells.length }, () => [{ type: "paragraph" } as DocNode])];
    return { type: "tableRow", content: full.map((c) => ({ type: headerRow && i === 0 ? "tableHeader" : "tableCell", content: c }) as DocNode) } as DocNode;
  });
  return { node: { type: "table", content }, padded };
}

/** An image reference as items: a lifted image block for a local file, or its alt text (with a warning) when it cannot be imported. */
export function imageItems(
  url: string,
  alt: string,
  title: string | null | undefined,
  line: number | undefined,
  ctx: { warn: Warnings; assets: AssetRegistry },
): Item[] {
  const u = url.trim();
  alt = cleanText(alt);
  if (/^https?:\/\//i.test(u) || u.startsWith("//")) {
    ctx.warn.at("remote-image", "warning", `Remote image not imported (no network access): ${u.slice(0, 80)}`, line);
  } else if (/^[a-z][a-z0-9+.-]*:/i.test(u) && !/^[a-z]:[\\/]/i.test(u)) {
    ctx.warn.at("unsupported-image", "warning", `Image with a ${u.split(":")[0]}: URL was not imported.`, line);
  } else {
    let path = u;
    try {
      path = decodeURI(u);
    } catch {
      /* keep raw */
    }
    path = path.split(/[?#]/)[0] ?? path;
    const ext = extOf(path);
    if (!IMAGE_TYPES[ext]) {
      ctx.warn.at("unsupported-image", "warning", `Image "${path.slice(0, 80)}" has an unsupported type and was not imported.`, line);
    } else {
      const a = ctx.assets.register(path, IMAGE_TYPES[ext]);
      return [{ sep: "block", node: { type: "image", attrs: { src: a.targetPath, alt: alt || null, title: title == null ? null : cleanText(title) } } }];
    }
  }
  const t = textNode(alt ? `[Image: ${alt}]` : "");
  return t ? [t] : [];
}
