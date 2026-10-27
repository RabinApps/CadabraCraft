import type { DocNode } from "@cadabracraft/shared";
import { INDENT } from "./parts";
import { attrsOf, fail, kidsOf } from "./helpers";
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
    ctx.s.ordered.push({ numId, start: typeof start === "number" && Number.isInteger(start) && start >= 0 ? start : 1 });
  }
  const out: string[] = [];
  const base = ctx.quote * INDENT;
  for (const li of kidsOf(n)) {
    if (li.type !== "listItem") fail(ctx, `The node "${li.type}" cannot be written in a list`, li.type);
    const inner: Ctx = { ...ctx, list: level + 1 };
    const left = base + INDENT * (level + 1);
    let first = true;
    for (const c of kidsOf(li)) {
      if (c.type === "paragraph") {
        const runs = inline(kidsOf(c), inner);
        if (first) out.push(para(runs, { style: "ListParagraph", numId, ilvl: level, left, hanging: 360 }, ctx));
        else if (runs !== "") out.push(para(runs, { style: "ListParagraph", left, firstLine: 0 }, ctx));
      } else {
        if (first) out.push(para("", { style: "ListParagraph", numId, ilvl: level, left, hanging: 360 }, ctx));
        out.push(...blockXml(c, inner));
      }
      first = false;
    }
    if (first) out.push(para("", { style: "ListParagraph", numId, ilvl: level, left, hanging: 360 }, ctx));
  }
  return out;
}
