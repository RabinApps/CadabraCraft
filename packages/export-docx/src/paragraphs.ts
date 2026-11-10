import { isLangTag, type DocNode, type Mark } from "@cadabracraft/shared";
import { FONT_NAMES } from "./parts";
import { esc } from "./xml";
import { checkText, fail, kidsOf } from "./helpers";
import type { Ctx, ParaOpts, RunProps } from "./types";

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
  "lang",
  "comment",
  "indexEntry",
  "glossaryTerm",
];

export function para(inner: string, o: ParaOpts, ctx: Ctx): string {
  const pb = ctx.s.pendingBreak;
  ctx.s.pendingBreak = false;
  const ind =
    o.left !== undefined ||
    o.right !== undefined ||
    o.firstLine !== undefined ||
    o.hanging !== undefined
      ? `<w:ind${o.left !== undefined ? ` w:left="${o.left}"` : ""}${o.right !== undefined ? ` w:right="${o.right}"` : ""}${o.hanging !== undefined ? ` w:hanging="${o.hanging}"` : ""}${o.firstLine !== undefined ? ` w:firstLine="${o.firstLine}"` : ""}/>`
      : "";
  const ppr = `${o.style ? `<w:pStyle w:val="${o.style}"/>` : ""}${o.keepNext ? "<w:keepNext/>" : ""}${pb ? "<w:pageBreakBefore/>" : ""}${
    o.numId !== undefined
      ? `<w:numPr><w:ilvl w:val="${o.ilvl ?? 0}"/><w:numId w:val="${o.numId}"/></w:numPr>`
      : ""
  }${o.spaceBefore !== undefined ? `<w:spacing w:before="${o.spaceBefore}"/>` : ""}${ind}${o.jc ? `<w:jc w:val="${o.jc}"/>` : ""}${o.sect ?? ""}`;
  return `<w:p>${ppr ? `<w:pPr>${ppr}</w:pPr>` : ""}${inner}</w:p>`;
}

/** The set of mark types and the language of a `lang` mark; throws on a mark Word cannot hold. */
function scanMarks(marks: Mark[], ctx: Ctx): { types: Set<string>; lang: string } {
  const types = new Set<string>();
  let lang = "";
  for (const m of marks) {
    const type = (m as { type?: unknown }).type;
    if (!MARK_TYPES.includes(type as Mark["type"]))
      fail(ctx, `The mark "${String(type)}" has no Word form`, String(type));
    types.add(m.type);
    if (m.type === "lang") {
      if (!isLangTag(m.attrs?.lang))
        fail(ctx, "The language of a passage must be a BCP 47 tag", "lang");
      lang = m.attrs.lang;
    }
  }
  return { types, lang };
}

const vertAlign = (types: Set<string>): string =>
  types.has("superscript")
    ? '<w:vertAlign w:val="superscript"/>'
    : types.has("subscript")
      ? '<w:vertAlign w:val="subscript"/>'
      : "";

export function rPr(marks: Mark[], base: RunProps, ctx: Ctx, extraStyle?: string): string {
  const { types, lang } = scanMarks(marks, ctx);
  if (types.has("superscript") && types.has("subscript"))
    fail(ctx, "Text cannot be both superscript and subscript", "superscript");
  const style = extraStyle ?? (types.has("link") ? "Hyperlink" : undefined);
  const mono = FONT_NAMES.courier;
  return (
    (style ? `<w:rStyle w:val="${style}"/>` : "") +
    (types.has("code") ? `<w:rFonts w:ascii="${mono}" w:hAnsi="${mono}" w:cs="${mono}"/>` : "") +
    (types.has("bold") || base.bold ? "<w:b/><w:bCs/>" : "") +
    (types.has("italic") || base.italic ? "<w:i/><w:iCs/>" : "") +
    (types.has("smallCaps") ? "<w:smallCaps/>" : "") +
    (types.has("strike") ? "<w:strike/>" : "") +
    (types.has("underline") ? '<w:u w:val="single"/>' : "") +
    vertAlign(types) +
    (lang ? `<w:lang w:val="${lang}"/>` : "")
  );
}

/** Text with line feeds and tabs turned into Word breaks and tabs. */
export function textRuns(text: string, props: string): string {
  const parts = text.split(/(\n|\t)/);
  const rp = props ? `<w:rPr>${props}</w:rPr>` : "";
  return parts
    .filter((p) => p !== "")
    .map((p) =>
      p === "\n"
        ? `<w:r>${rp}<w:br/></w:r>`
        : p === "\t"
          ? `<w:r>${rp}<w:tab/></w:r>`
          : `<w:r>${rp}<w:t xml:space="preserve">${esc(p)}</w:t></w:r>`,
    )
    .join("");
}

export function addRel(ctx: Ctx, type: string, target: string, external = false): string {
  const id = `rId${ctx.s.rels.length + 1}`;
  ctx.s.rels.push({ id, type, target, ...(external ? { external } : {}) });
  return id;
}

export function linkRel(href: string, ctx: Ctx): string {
  let id = ctx.s.links.get(href);
  if (!id) {
    id = addRel(ctx, "hyperlink", href, true);
    ctx.s.links.set(href, id);
  }
  return id;
}

export function inline(nodes: DocNode[] | undefined, ctx: Ctx): string {
  let out = "";
  for (const n of nodes ?? []) {
    const type = n.type as string;
    if (n.type === "text") {
      if (n.text === "") continue;
      checkText(n.text, ctx, "A text run");
      const marks = n.marks ?? [];
      const runs = textRuns(n.text, rPr(marks, ctx.runProps, ctx));
      const link = marks.find((m) => m.type === "link");
      if (link) {
        const href = link.attrs?.href;
        if (!href) fail(ctx, "A link without an address cannot be written", "link");
        checkText(href, ctx, "A link address");
        out += `<w:hyperlink r:id="${linkRel(href, ctx)}" w:history="1">${runs}</w:hyperlink>`;
      } else out += runs;
    } else if (n.type === "footnote") {
      if (ctx.inNote) fail(ctx, "A footnote cannot contain another footnote", "footnote");
      const id = ctx.s.notes.length + 1;
      ctx.s.notes.push(""); // reserve the id before the content is rendered
      const body = inline(kidsOf(n), { ...ctx, inNote: true });
      ctx.s.notes[id - 1] =
        `<w:footnote w:id="${id}"><w:p><w:pPr><w:pStyle w:val="FootnoteText"/></w:pPr><w:r><w:rPr><w:rStyle w:val="FootnoteReference"/></w:rPr><w:footnoteRef/></w:r><w:r><w:t xml:space="preserve"> </w:t></w:r>${body}</w:p></w:footnote>`;
      out += `<w:r><w:rPr><w:rStyle w:val="FootnoteReference"/></w:rPr><w:footnoteReference w:id="${id}"/></w:r>`;
    } else if (type === "hardBreak") {
      out += "<w:r><w:br/></w:r>";
    } else {
      fail(ctx, `The node "${type}" cannot be written inside a paragraph`, type);
    }
  }
  return out;
}
