import { parseTextAlign, type DocNode, type TextAlign } from "@cadabracraft/shared";

/** `node` with the alignment `align` when it is a paragraph or heading that has none yet; anything else, and `null`, leaves it as it is. */
export function withAlign(node: DocNode, align: TextAlign | null): DocNode {
  if (align === null || (node.type !== "paragraph" && node.type !== "heading")) return node;
  if (node.attrs?.textAlign) return node;
  return { ...node, attrs: { ...node.attrs, textAlign: align } };
}

/** The alignments of `nodes` (from index `from`) set to `align` where the node has none; replaces the entries in place. */
export function alignFrom(nodes: DocNode[], from: number, align: TextAlign | null): void {
  if (align === null) return;
  for (let i = from; i < nodes.length; i++) nodes[i] = withAlign(nodes[i]!, align);
}

/**
 * The alignment a stylesheet or attribute value names: `center`, `left` / `start` and `right` / `end` (left and right are the sides of
 * left-to-right text); `justify` and anything else is no choice (null). `value` may be a whole `style` attribute.
 */
export function alignOfCss(value: string | undefined): TextAlign | null {
  const m = /(?:^|;)\s*text-align\s*:\s*([a-z-]+)/i.exec(value ?? "");
  return alignName((m ? m[1]! : (value ?? "")).trim().toLowerCase());
}

function alignName(name: string): TextAlign | null {
  switch (name) {
    case "center":
      return "center";
    case "left":
    case "start":
      return "start";
    case "right":
    case "end":
      return "end";
    default:
      return null;
  }
}

/** The alignment of an HTML element from its own attributes: ours (`data-text-align`, the `align-*` class), the `align` attribute, then `style`. */
export function alignOfAttrs(get: (name: string) => string | undefined): TextAlign | null {
  const own = parseTextAlign(get("data-text-align"));
  if (own) return own;
  for (const a of ["start", "center", "end"] as const)
    if ((get("class") ?? "").split(/\s+/).includes(`align-${a}`)) return a;
  return alignOfCss(get("style")) ?? alignOfCss(get("align"));
}
