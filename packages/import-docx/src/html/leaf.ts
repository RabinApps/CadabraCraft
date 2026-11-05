import { paragraphOf, textNode } from "../common";
import { attr, isElement, isText, textOf, type HtmlCtx, type PElement } from "./dom";
import type { Flow } from "./run";

// Leaf helpers of the HTML converter (no recursion into `flow`).
/** Flatten a too-deeply nested element to a plain paragraph. */
export function tooDeep(el: PElement, ctx: HtmlCtx, f: Flow): void {
  ctx.warn.at(
    "nesting-too-deep",
    "warning",
    `Nesting deeper than ${ctx.maxDepth} levels was flattened to text.`,
  );
  const t = textNode(textOf(el));
  if (t) f.out.push(paragraphOf([t]));
}

/** The checkbox that makes a list item a task item: an `<input type=checkbox>` first in the item, alone or inside a `<label>`. */
export function checkboxOf(li: PElement): boolean | null {
  for (const c of li.childNodes) {
    if (isText(c) && c.value.trim() === "") continue;
    if (!isElement(c)) return null;
    const input =
      c.tagName === "input"
        ? c
        : c.tagName === "label"
          ? c.childNodes.find((k): k is PElement => isElement(k) && k.tagName === "input")
          : undefined;
    if (!input || attr(input, "type")?.toLowerCase() !== "checkbox") return null;
    return attr(input, "checked") !== undefined || attr(li, "data-checked") === "true";
  }
  return null;
}
