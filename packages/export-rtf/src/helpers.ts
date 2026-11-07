import { parseTextAlign, textAlignProblem, type DocNode } from "@cadabracraft/shared";
import { RtfExportError } from "./errors";
import { illegalChar } from "./text";
import type { Ctx } from "./types";

export const attrsOf = (n: DocNode): Record<string, string | number | boolean | null> =>
  "attrs" in n && n.attrs ? n.attrs : {};
export const kidsOf = (n: DocNode): DocNode[] => ("content" in n && n.content ? n.content : []);

export function fail(ctx: Ctx, message: string, node?: string): never {
  throw new RtfExportError(message, { chapter: ctx.chapter, node });
}

const JC = { start: "l", center: "c", end: "r" } as const;

/**
 * The `\q` letter of a paragraph or heading the author aligned (undefined: the template's own, left). `start` and `end` are
 * `\ql` and `\qr`, which a reader takes as the side a line begins on and ends on; an RTF file is only written for left-to-right books.
 */
export function jcOf(n: DocNode, ctx: Ctx): "l" | "c" | "r" | undefined {
  const align = parseTextAlign(attrsOf(n).textAlign);
  if (align === undefined) fail(ctx, textAlignProblem(attrsOf(n).textAlign)!, n.type);
  return align === null ? undefined : JC[align];
}

export function checkText(text: string, ctx: Ctx, what: string): string {
  const bad = illegalChar(text);
  if (bad)
    fail(ctx, `${what} contains the character ${bad}, which an RTF file cannot hold`, "text");
  return text;
}
