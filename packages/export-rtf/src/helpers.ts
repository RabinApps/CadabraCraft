import type { DocNode } from "@cadabracraft/shared";
import { RtfExportError } from "./errors";
import { illegalChar } from "./text";
import type { Ctx } from "./types";

export const attrsOf = (n: DocNode): Record<string, string | number | null> =>
  "attrs" in n && n.attrs ? n.attrs : {};
export const kidsOf = (n: DocNode): DocNode[] => ("content" in n && n.content ? n.content : []);

export function fail(ctx: Ctx, message: string, node?: string): never {
  throw new RtfExportError(message, { chapter: ctx.chapter, node });
}

export function checkText(text: string, ctx: Ctx, what: string): string {
  const bad = illegalChar(text);
  if (bad)
    fail(ctx, `${what} contains the character ${bad}, which an RTF file cannot hold`, "text");
  return text;
}
