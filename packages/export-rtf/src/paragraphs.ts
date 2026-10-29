import type { DocNode, Mark } from "@cadabracraft/shared";
import { checkText, fail, kidsOf } from "./helpers";
import { esc } from "./text";
import type { Ctx, ParaOpts, RunProps } from "./types";

/** Double line spacing (240 = single) and the 0.5 inch first-line indent, in twips. */
const DOUBLE = 480;
export const INDENT = 720;

const MARK_TYPES: Mark["type"][] = [
  "bold",
  "italic",
  "underline",
  "smallCaps",
  "strike",
  "code",
  "superscript",
  "subscript",
  "link",
];

/** The paragraph-formatting control words of `o` (every one is written, so nothing depends on inherited state). Consumes a pending page break. */
export function paraOpen(o: ParaOpts, ctx: Ctx): string {
  const pb = ctx.s.pendingBreak;
  ctx.s.pendingBreak = false;
  return (
    `\\pard\\plain${o.cell ? "\\intbl" : ""}${o.mono ? "\\f1" : "\\f0"}\\fs${o.size ?? 24}` +
    `\\sl${o.single ? 240 : DOUBLE}\\slmult1\\sb${o.before ?? 0}\\sa${o.after ?? 0}` +
    `\\li${o.left ?? 0}\\ri${o.right ?? 0}\\fi${o.firstLine ?? INDENT}\\q${o.jc ?? "l"}` +
    `${o.keepNext ? "\\keepn" : ""}${pb ? "\\pagebb" : ""}` +
    `${o.outline !== undefined ? `\\outlinelevel${o.outline}` : ""}${o.bold ? "\\b" : ""}${o.italic ? "\\i" : ""}`
  );
}

/** One paragraph, in its own group. */
export const para = (inner: string, o: ParaOpts, ctx: Ctx): string =>
  `{${paraOpen(o, ctx)} ${inner}\\par}`;

/** The character-formatting control words for a run, in a fixed order. */
export function runWords(marks: Mark[], base: RunProps, ctx: Ctx): string {
  const types = new Set<string>();
  for (const m of marks) {
    const type = (m as { type?: unknown }).type;
    if (!MARK_TYPES.includes(type as Mark["type"]))
      fail(ctx, `The mark "${String(type)}" has no RTF form`, String(type));
    types.add(m.type);
  }
  if (types.has("superscript") && types.has("subscript"))
    fail(ctx, "Text cannot be both superscript and subscript", "superscript");
  return (
    (types.has("code") ? "\\f1" : "") +
    (types.has("bold") || base.bold ? "\\b" : "") +
    (types.has("italic") ? "\\i" : "") +
    (types.has("smallCaps") ? "\\scaps" : "") +
    (types.has("strike") ? "\\strike" : "") +
    (types.has("underline") || types.has("link") ? "\\ul" : "") +
    (types.has("link") ? "\\cf1" : "") +
    (types.has("superscript") ? "\\super" : types.has("subscript") ? "\\sub" : "")
  );
}

/** Text with line feeds and tabs turned into RTF breaks and tabs, inside a group carrying `words` when there are any. */
export function textRuns(text: string, words: string): string {
  const body = text
    .split(/(\r\n|\r|\n|\t)/)
    .filter((p) => p !== "")
    .map((p) => (p === "\t" ? "\\tab " : /^[\r\n]/.test(p) ? "\\line " : esc(p)))
    .join("");
  return words ? `{${words} ${body}}` : body;
}

export function inline(nodes: DocNode[] | undefined, ctx: Ctx): string {
  let out = "";
  for (const n of nodes ?? []) {
    const type = n.type as string;
    if (n.type === "text") {
      if (n.text === "") continue;
      checkText(n.text, ctx, "A text run");
      const marks = n.marks ?? [];
      const runs = textRuns(n.text, runWords(marks, ctx.runProps, ctx));
      const link = marks.find((m) => m.type === "link");
      if (link) {
        const href = link.attrs?.href;
        if (!href) fail(ctx, "A link without an address cannot be written", "link");
        checkText(href, ctx, "A link address");
        out += `{\\field{\\*\\fldinst{HYPERLINK "${esc(href.replace(/"/g, "%22"))}"}}{\\fldrslt ${runs}}}`;
      } else out += runs;
    } else if (n.type === "footnote") {
      if (ctx.inNote) fail(ctx, "A footnote cannot contain another footnote", "footnote");
      const body = inline(kidsOf(n), { ...ctx, inNote: true });
      out += `{\\super\\chftn {\\footnote\\pard\\plain\\f0\\fs20\\sl240\\slmult1\\li0\\fi0 {\\super\\chftn} ${body}\\par}}`;
    } else if (type === "hardBreak") {
      out += "\\line ";
    } else {
      fail(ctx, `The node "${type}" cannot be written inside a paragraph`, type);
    }
  }
  return out;
}
