import type { DocNode } from "@cadabracraft/shared";
import { INDENT } from "./parts";
import { attrsOf, fail, jcOf, kidsOf } from "./helpers";
import { inline, para } from "./paragraphs";
import type { Ctx } from "./types";

/** Renders one block node; passed in by `blockXml` so lists and blocks do not import each other. */
export type BlockRenderer = (n: DocNode, ctx: Ctx) => string[];

export function listXml(n: DocNode, ctx: Ctx, blockXml: BlockRenderer): string[] {
  const ordered = n.type === "orderedList";
  const level = ctx.list;
  if (level >= 9) fail(ctx, "Lists nested more than 9 levels deep cannot be written", n.type);
  let numId = 1;
  if (ordered) {
    const start = attrsOf(n).start;
    numId = ctx.s.ordered.length + 2;
    ctx.s.ordered.push({
      numId,
      start: typeof start === "number" && Number.isInteger(start) && start >= 0 ? start : 1,
    });
  }
  const out: string[] = [];
  const base = ctx.quote * INDENT;
  for (const li of kidsOf(n)) {
    if (li.type !== "listItem")
      fail(ctx, `The node "${li.type}" cannot be written in a list`, li.type);
    const inner: Ctx = { ...ctx, list: level + 1 };
    const left = base + INDENT * (level + 1);
    let first = true;
    for (const c of kidsOf(li)) {
      if (c.type === "paragraph") {
        const runs = inline(kidsOf(c), inner);
        if (first)
          out.push(
            para(
              runs,
              { style: "ListParagraph", numId, ilvl: level, left, hanging: 360, jc: jcOf(c, ctx) },
              ctx,
            ),
          );
        else if (runs !== "")
          out.push(
            para(runs, { style: "ListParagraph", left, firstLine: 0, jc: jcOf(c, ctx) }, ctx),
          );
      } else {
        if (first)
          out.push(
            para("", { style: "ListParagraph", numId, ilvl: level, left, hanging: 360 }, ctx),
          );
        out.push(...blockXml(c, inner));
      }
      first = false;
    }
    if (first)
      out.push(para("", { style: "ListParagraph", numId, ilvl: level, left, hanging: 360 }, ctx));
  }
  return out;
}

/** A Word checkbox content control (Word 2010 `w14:checkbox`), followed by a space, in front of a task item's text. */
const checkbox = (checked: boolean): string =>
  `<w:sdt><w:sdtPr><w14:checkbox><w14:checked w14:val="${checked ? 1 : 0}"/><w14:checkedState w14:val="2612" w14:font="MS Gothic"/><w14:uncheckedState w14:val="2610" w14:font="MS Gothic"/></w14:checkbox></w:sdtPr><w:sdtContent><w:r><w:rPr><w:rFonts w:ascii="MS Gothic" w:eastAsia="MS Gothic" w:hAnsi="MS Gothic" w:hint="eastAsia"/></w:rPr><w:t>${checked ? "☒" : "☐"}</w:t></w:r></w:sdtContent></w:sdt><w:r><w:t xml:space="preserve"> </w:t></w:r>`;

/** Task lists: indented like a list, with a checkbox control instead of a bullet. */
export function taskListXml(n: DocNode, ctx: Ctx, blockXml: BlockRenderer): string[] {
  const level = ctx.list;
  if (level >= 9) fail(ctx, "Lists nested more than 9 levels deep cannot be written", n.type);
  const out: string[] = [];
  const left = ctx.quote * INDENT + INDENT * (level + 1);
  for (const li of kidsOf(n)) {
    if (li.type !== "taskItem")
      fail(ctx, `The node "${li.type}" cannot be written in a task list`, li.type);
    const checked = attrsOf(li).checked ?? false;
    if (typeof checked !== "boolean")
      fail(ctx, "A task item's checked value must be true or false", li.type);
    const inner: Ctx = { ...ctx, list: level + 1 };
    const [head, ...rest] = kidsOf(li);
    if (head?.type !== "paragraph") fail(ctx, "A task item must start with a paragraph", li.type);
    out.push(
      para(
        checkbox(checked) + inline(kidsOf(head!), inner),
        { style: "ListParagraph", left, hanging: 360, jc: jcOf(head!, ctx) },
        ctx,
      ),
    );
    for (const c of rest) {
      if (c.type === "paragraph") {
        const runs = inline(kidsOf(c), inner);
        if (runs !== "")
          out.push(
            para(runs, { style: "ListParagraph", left, firstLine: 0, jc: jcOf(c, ctx) }, ctx),
          );
      } else out.push(...blockXml(c, inner));
    }
  }
  return out;
}

/** One description of a definition list, indented one step. */
function descriptionXml(k: DocNode, ctx: Ctx, base: number, blockXml: BlockRenderer): string[] {
  const out: string[] = [];
  const inner: Ctx = { ...ctx, quote: ctx.quote + 1 };
  const [head, ...rest] = kidsOf(k);
  if (head?.type !== "paragraph") fail(ctx, "A definition must start with a paragraph", k.type);
  const opts = { style: "Definition", left: base + INDENT, firstLine: 0 };
  out.push(para(inline(kidsOf(head!), ctx), { ...opts, jc: jcOf(head!, ctx) }, ctx));
  for (const c of rest) {
    if (c.type === "paragraph") {
      const runs = inline(kidsOf(c), ctx);
      if (runs !== "") out.push(para(runs, { ...opts, jc: jcOf(c, ctx) }, ctx));
    } else out.push(...blockXml(c, inner));
  }
  return out;
}

/** Definition lists: "Definition Term" paragraphs (Word's own style names) followed by indented "Definition" paragraphs. */
export function definitionListXml(n: DocNode, ctx: Ctx, blockXml: BlockRenderer): string[] {
  const out: string[] = [];
  const base = ctx.quote * INDENT;
  for (const k of kidsOf(n)) {
    if (k.type === "definitionTerm") {
      out.push(
        para(
          inline(kidsOf(k), ctx),
          { style: "DefinitionTerm", ...(base ? { left: base, firstLine: 0 } : {}) },
          ctx,
        ),
      );
    } else if (k.type === "definitionDescription") {
      out.push(...descriptionXml(k, ctx, base, blockXml));
    } else fail(ctx, `The node "${k.type}" cannot be written in a definition list`, k.type);
  }
  return out;
}
