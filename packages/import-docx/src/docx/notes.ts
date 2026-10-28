import { attr, childrenNamed, parseXml, tagOf, type XNode } from "./xml";
import type { DCtx } from "./types";

/** Footnotes and endnotes by `<kind>:<id>`, skipping separators and continuation notices. */
export function collectNotes(files: Record<string, Uint8Array>): DCtx["notes"] {
  const notes = new Map<string, { el: XNode; kind: "footnote" | "endnote" }>();
  for (const [part, tag, kind] of [
    ["word/footnotes.xml", "footnotes", "footnote"],
    ["word/endnotes.xml", "endnotes", "endnote"],
  ] as const) {
    const b = files[part];
    if (!b) continue;
    const root = parseXml(b, part).find((n) => tagOf(n) === tag);
    if (!root) continue;
    for (const el of childrenNamed(root, kind)) {
      const id = attr(el, "id");
      const ty = attr(el, "type");
      if (id !== undefined && (ty === undefined || ty === "normal"))
        notes.set(`${kind}:${id}`, { el, kind });
    }
  }
  return notes;
}
