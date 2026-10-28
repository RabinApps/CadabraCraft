import { attr, child, childrenNamed, tagOf, type XNode } from "./xml";
import type { DCtx, Numbering } from "./types";

export function parseNumbering(root: XNode[] | undefined): Numbering {
  const out: Numbering = { nums: new Map(), abstracts: new Map() };
  const n = root?.find((x) => tagOf(x) === "numbering");
  if (!n) return out;
  for (const a of childrenNamed(n, "abstractNum")) {
    const id = attr(a, "abstractNumId");
    if (id === undefined) continue;
    const lv = new Map<number, string>();
    for (const l of childrenNamed(a, "lvl"))
      lv.set(Number(attr(l, "ilvl") ?? 0), attr(child(l, "numFmt") ?? {}, "val") ?? "decimal");
    out.abstracts.set(id, lv);
  }
  for (const num of childrenNamed(n, "num")) {
    const id = attr(num, "numId");
    const abs = attr(child(num, "abstractNumId") ?? {}, "val");
    if (id !== undefined && abs !== undefined) out.nums.set(id, abs);
  }
  return out;
}

export function numberingFor(numId: string, ilvl: number, ctx: DCtx): boolean | null {
  if (numId === "0") return null;
  const abs = ctx.numbering.nums.get(numId);
  const fmt = abs !== undefined ? ctx.numbering.abstracts.get(abs)?.get(ilvl) : undefined;
  if (fmt === undefined) return false;
  return fmt !== "bullet" && fmt !== "none";
}
