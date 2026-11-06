import type { TextAlign } from "@cadabracraft/shared";
import { isSep } from "../common";
import { numberingFor } from "./numbering";
import type { Cls } from "./styles";
import type { DCtx, PState } from "./types";
import { attr, child, on, type XNode } from "./xml";

/** Section and page breaks are not imported: say so. */
export function warnBreaks(pPr: XNode | undefined, ctx: DCtx): void {
  if (!pPr) return;
  if (child(pPr, "sectPr"))
    ctx.warn.tally(
      "section-break",
      "info",
      "Section breaks are ignored; use scene breaks for separations.",
    );
  if (on(child(pPr, "pageBreakBefore")))
    ctx.warn.tally(
      "page-break",
      "info",
      "Page and column breaks are ignored; use scene breaks for separations.",
    );
}

/** The list (numbering id and level) a paragraph belongs to: its own `numPr` first, then the one of its style or of the styles it is based on. */
function numberingOf(
  pPr: XNode | undefined,
  styleId: string | undefined,
  ctx: DCtx,
): { numId: string | undefined; ilvl: number } {
  const numPr = pPr ? child(pPr, "numPr") : undefined;
  let numId = numPr ? attr(child(numPr, "numId") ?? {}, "val") : undefined;
  let ilvl = numPr ? Number(attr(child(numPr, "ilvl") ?? {}, "val") ?? 0) : 0;
  if (numId === undefined && styleId) {
    let sid: string | undefined = styleId;
    for (let i = 0; i < 12 && sid && numId === undefined; i++) {
      const s = ctx.styles.get(sid);
      if (s?.numId !== undefined) {
        numId = s.numId;
        // A style that has a numId always has an ilvl too (both come from the same numPr), so the fallback is unreachable.
        /* v8 ignore next -- @preserve */
        ilvl = s.ilvl ?? 0;
      }
      sid = s?.basedOn;
    }
  }
  return { numId, ilvl };
}

/** A normal paragraph that sits in a numbered or bulleted list becomes a list paragraph. */
export function withListMembership(
  cls: Cls,
  pPr: XNode | undefined,
  styleId: string | undefined,
  ctx: DCtx,
  maxLevel: number,
): Cls {
  if (cls.kind !== "normal" && cls.kind !== "list") return cls;
  const { numId, ilvl } = numberingOf(pPr, styleId, ctx);
  if (numId === undefined) return cls;
  const ordered = numberingFor(numId, ilvl, ctx);
  if (ordered === null) return cls;
  return { kind: "list", ordered, level: Math.min(Math.max(ilvl, 0), maxLevel) };
}

/** A paragraph that begins with a Word checkbox control is a task item (nested by its list level or its indent). */
export function withTaskItem(cls: Cls, pPr: XNode | undefined, st: PState, maxLevel: number): Cls {
  if ((cls.kind !== "normal" && cls.kind !== "list") || st.checkbox === undefined) return cls;
  const ind = pPr ? child(pPr, "ind") : undefined;
  const left = Number(ind ? (attr(ind, "left") ?? attr(ind, "start") ?? 0) : 0);
  const level =
    cls.kind === "list" ? cls.level : Math.min(Math.max(Math.round(left / 720) - 1, 0), maxLevel);
  const first = st.items[0];
  if (first && !isSep(first) && first.type === "text")
    st.items[0] = { ...first, text: first.text.replace(/^\s+/, "") };
  return { kind: "list", ordered: false, level, checked: st.checkbox };
}

/**
 * Only a paragraph's own centre or right is the author's choice. Left (and start, and justified) is what the style says, which
 * generators write on every paragraph, so reading it would make a whole book ragged.
 */
export const alignOf = (jc: string | undefined): TextAlign | null =>
  jc === "center" ? "center" : jc === "right" || jc === "end" ? "end" : null;
