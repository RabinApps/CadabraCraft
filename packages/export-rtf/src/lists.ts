import type { DocNode } from "@cadabracraft/shared";
import { attrsOf, fail, jcOf, kidsOf } from "./helpers";
import { inline, INDENT, para } from "./paragraphs";
import { esc } from "./text";
import type { Ctx } from "./types";

/** Renders one block node; passed in by `blockRtf` so lists and blocks do not import each other. */
export type BlockRenderer = (n: DocNode, ctx: Ctx) => string[];

/** a, b, … z, aa, ab, … */
function letters(n: number): string {
  let out = "";
  for (let k = n; k > 0; k = Math.floor((k - 1) / 26))
    out = String.fromCharCode(97 + ((k - 1) % 26)) + out;
  return out;
}

const ROMAN: [number, string][] = [
  [1000, "m"],
  [900, "cm"],
  [500, "d"],
  [400, "cd"],
  [100, "c"],
  [90, "xc"],
  [50, "l"],
  [40, "xl"],
  [10, "x"],
  [9, "ix"],
  [5, "v"],
  [4, "iv"],
  [1, "i"],
];

function roman(n: number): string {
  let out = "";
  let rest = n;
  for (const [value, text] of ROMAN)
    while (rest >= value) {
      out += text;
      rest -= value;
    }
  return out;
}

/** The label of an ordered item: decimal, lower letters and lower Roman numerals by nesting level; decimal where the others have no form (0, above 3999). */
export function orderedLabel(n: number, level: number): string {
  const kind = level % 3;
  if (kind === 1 && n >= 1) return `${letters(n)}.`;
  if (kind === 2 && n >= 1 && n <= 3999) return `${roman(n)}.`;
  return `${n}.`;
}

/**
 * Lists are written as hanging-indent paragraphs with a literal marker and a tab, not as RTF list tables: every reader shows
 * them the same way and the numbers cannot drift, at the price that Word does not renumber them when the author edits.
 */
export function listRtf(n: DocNode, ctx: Ctx, blockRtf: BlockRenderer): string[] {
  const ordered = n.type === "orderedList";
  const level = ctx.list;
  if (level >= 9) fail(ctx, "Lists nested more than 9 levels deep cannot be written", n.type);
  const startAttr = attrsOf(n).start;
  let count =
    typeof startAttr === "number" && Number.isInteger(startAttr) && startAttr >= 0 ? startAttr : 1;
  const out: string[] = [];
  const base = ctx.quote * INDENT;
  for (const li of kidsOf(n)) {
    if (li.type !== "listItem")
      fail(ctx, `The node "${li.type}" cannot be written in a list`, li.type);
    const inner: Ctx = { ...ctx, list: level + 1 };
    const left = base + INDENT * (level + 1);
    const label = `${esc(ordered ? orderedLabel(count++, level) : level % 2 === 0 ? "•" : "–")}\\tab `;
    let first = true;
    for (const c of kidsOf(li)) {
      if (c.type === "paragraph") {
        const runs = inline(kidsOf(c), inner);
        const jc = jcOf(c, ctx);
        if (first) out.push(para(label + runs, { left, firstLine: -360, jc }, ctx));
        else if (runs !== "") out.push(para(runs, { left, firstLine: 0, jc }, ctx));
      } else {
        if (first) out.push(para(label, { left, firstLine: -360 }, ctx));
        out.push(...blockRtf(c, inner));
      }
      first = false;
    }
    if (first) out.push(para(label, { left, firstLine: -360 }, ctx));
  }
  return out;
}

/** Task lists: the same hanging indent as a bullet list, with a ballot box (☐ open, ☒ checked) as the marker. */
export function taskListRtf(n: DocNode, ctx: Ctx, blockRtf: BlockRenderer): string[] {
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
    const label = `${esc(checked ? "☒" : "☐")}\\tab `;
    const [head, ...rest] = kidsOf(li);
    if (head?.type !== "paragraph") fail(ctx, "A task item must start with a paragraph", li.type);
    out.push(
      para(
        label + inline(kidsOf(head!), inner),
        { left, firstLine: -360, jc: jcOf(head!, ctx) },
        ctx,
      ),
    );
    for (const c of rest) {
      if (c.type === "paragraph") {
        const runs = inline(kidsOf(c), inner);
        if (runs !== "") out.push(para(runs, { left, firstLine: 0, jc: jcOf(c, ctx) }, ctx));
      } else out.push(...blockRtf(c, inner));
    }
  }
  return out;
}

/** One description of a definition list, indented one step. */
function descriptionRtf(k: DocNode, ctx: Ctx, base: number, blockRtf: BlockRenderer): string[] {
  const out: string[] = [];
  const inner: Ctx = { ...ctx, quote: ctx.quote + 1 };
  const [head, ...rest] = kidsOf(k);
  if (head?.type !== "paragraph") fail(ctx, "A definition must start with a paragraph", k.type);
  const opts = { left: base + INDENT, firstLine: 0 };
  out.push(para(inline(kidsOf(head!), ctx), { ...opts, jc: jcOf(head!, ctx) }, ctx));
  for (const c of rest) {
    if (c.type === "paragraph") {
      const runs = inline(kidsOf(c), ctx);
      if (runs !== "") out.push(para(runs, { ...opts, jc: jcOf(c, ctx) }, ctx));
    } else out.push(...blockRtf(c, inner));
  }
  return out;
}

/** Definition lists: each term as a bold paragraph that stays with its description, descriptions indented one step. */
export function definitionListRtf(n: DocNode, ctx: Ctx, blockRtf: BlockRenderer): string[] {
  const out: string[] = [];
  const base = ctx.quote * INDENT;
  for (const k of kidsOf(n)) {
    if (k.type === "definitionTerm") {
      out.push(
        para(inline(kidsOf(k), ctx), { bold: true, keepNext: true, firstLine: 0, left: base }, ctx),
      );
    } else if (k.type === "definitionDescription") {
      out.push(...descriptionRtf(k, ctx, base, blockRtf));
    } else fail(ctx, `The node "${k.type}" cannot be written in a definition list`, k.type);
  }
  return out;
}
