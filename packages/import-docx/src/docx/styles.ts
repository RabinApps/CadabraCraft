import { attr, child, childrenNamed, on, tagOf, type XNode } from "./xml";
import type { DCtx, StyleInfo } from "./types";

export type Cls =
  | { kind: "heading"; level: number }
  | { kind: "quote" }
  | { kind: "code" }
  | { kind: "list"; ordered: boolean; level: number }
  | { kind: "normal"; fallback?: string };

export function parseStyles(root: XNode[] | undefined): Map<string, StyleInfo> {
  const map = new Map<string, StyleInfo>();
  const styles = root?.find((n) => tagOf(n) === "styles");
  if (!styles) return map;
  for (const s of childrenNamed(styles, "style")) {
    const id = attr(s, "styleId");
    if (!id) continue;
    const rPr = child(s, "rPr");
    const numPr = child(child(s, "pPr") ?? {}, "numPr");
    map.set(id, {
      type: attr(s, "type") ?? "paragraph",
      name: attr(child(s, "name") ?? {}, "val") ?? id,
      basedOn: attr(child(s, "basedOn") ?? {}, "val"),
      numId: numPr ? attr(child(numPr, "numId") ?? {}, "val") : undefined,
      ilvl: numPr ? Number(attr(child(numPr, "ilvl") ?? {}, "val") ?? 0) : undefined,
      bold: on(rPr && child(rPr, "b")),
      italic: on(rPr && child(rPr, "i")),
      underline: on(rPr && child(rPr, "u")),
      smallCaps: on(rPr && child(rPr, "smallCaps")),
    });
  }
  return map;
}

export function classify(styleId: string | undefined, ctx: DCtx): Cls {
  if (!styleId) return { kind: "normal" };
  let id: string | undefined = styleId;
  const first = ctx.styles.get(styleId);
  for (let i = 0; i < 12 && id; i++) {
    const st = ctx.styles.get(id);
    if (!st) break;
    const name = st.name.toLowerCase().trim();
    let m: RegExpExecArray | null;
    if ((m = /^heading ([1-9])$/.exec(name))) return { kind: "heading", level: Number(m[1]) };
    if (["quote", "block quote", "intense quote", "block text"].includes(name)) return { kind: "quote" };
    if (["code", "source code", "preformatted text"].includes(name)) return { kind: "code" };
    if ((m = /^list bullet(?: (\d))?$/.exec(name))) return { kind: "list", ordered: false, level: m[1] ? Number(m[1]) - 1 : 0 };
    if ((m = /^list number(?: (\d))?$/.exec(name))) return { kind: "list", ordered: true, level: m[1] ? Number(m[1]) - 1 : 0 };
    if (["normal", "body text", "body text 2", "body text 3", "first paragraph", "no spacing", "plain text", "list paragraph", "default"].includes(name))
      return { kind: "normal" };
    id = st.basedOn;
  }
  return { kind: "normal", fallback: first?.name ?? styleId };
}
