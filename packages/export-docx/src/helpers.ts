import type { DocNode } from "@cadabracraft/shared";
import { DocxExportError } from "./errors";
import { illegalXmlChar } from "./xml";
import type { Ctx } from "./types";

export const attrsOf = (n: DocNode): Record<string, string | number | boolean | null> =>
  "attrs" in n && n.attrs ? n.attrs : {};
export const kidsOf = (n: DocNode): DocNode[] => ("content" in n && n.content ? n.content : []);

export function fail(ctx: Ctx, message: string, node?: string): never {
  throw new DocxExportError(message, { chapter: ctx.chapter, node });
}

export function checkText(text: string, ctx: Ctx, what: string): string {
  const bad = illegalXmlChar(text);
  if (bad)
    fail(ctx, `${what} contains the character ${bad}, which a Word file cannot hold`, "text");
  return text;
}
