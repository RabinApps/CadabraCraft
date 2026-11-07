import { parseTextAlign, textAlignProblem, type DocNode } from "@cadabracraft/shared";
import { DocxExportError } from "./errors";
import { illegalXmlChar } from "./xml";
import type { Ctx } from "./types";

export const attrsOf = (n: DocNode): Record<string, string | number | boolean | null> =>
  "attrs" in n && n.attrs ? n.attrs : {};
export const kidsOf = (n: DocNode): DocNode[] => ("content" in n && n.content ? n.content : []);

export function fail(ctx: Ctx, message: string, node?: string): never {
  throw new DocxExportError(message, { chapter: ctx.chapter, node });
}

const JC = { start: "left", center: "center", end: "right" } as const;

/**
 * The `w:jc` value of a paragraph or heading the author aligned (undefined: the style's own). `start` and `end` are written as
 * `left` and `right`, which Word reads as the side a line begins on and ends on (it mirrors them in a right-to-left paragraph); a
 * Word file is only written for left-to-right books anyway.
 */
export function jcOf(n: DocNode, ctx: Ctx): "left" | "center" | "right" | undefined {
  const align = parseTextAlign(attrsOf(n).textAlign);
  if (align === undefined) fail(ctx, textAlignProblem(attrsOf(n).textAlign)!, n.type);
  return align === null ? undefined : JC[align];
}

export function checkText(text: string, ctx: Ctx, what: string): string {
  const bad = illegalXmlChar(text);
  if (bad)
    fail(ctx, `${what} contains the character ${bad}, which a Word file cannot hold`, "text");
  return text;
}
