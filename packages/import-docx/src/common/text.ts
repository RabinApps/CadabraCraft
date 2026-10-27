import type { DocNode, Mark } from "@cadabracraft/shared";

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

export const SCENE_BREAK_TEXT = /^(\*(\s*\*){2,}|#)$/;
