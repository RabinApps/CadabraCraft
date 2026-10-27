import type { DocNode, Mark } from "@cadabracraft/shared";
import { escapeMarkup, typstString } from "../escape";
import { PdfExportError } from "../errors";
import { unsupported, type Ctx } from "./ctx";

const SAFE_LINK = /^(https?:|mailto:)/i;

function wrapMark(content: string, m: Mark): string {
  switch (m.type) {
    case "bold": return `#strong[${content}]`;
    case "italic": return `#emph[${content}]`;
    case "underline": return `#underline[${content}]`;
    case "smallCaps": return `#smallcaps[${content}]`;
    case "strike": return `#strike[${content}]`;
    case "superscript": return `#super[${content}]`;
    case "subscript": return `#sub[${content}]`;
    // Inline code is emitted as a raw string by `inline`, which has the unescaped text.
    case "code": return content;
    case "link": {
      const href = m.attrs?.href?.trim() ?? "";
      // Anything but http(s)/mailto keeps its text and loses the link.
      return SAFE_LINK.test(href) ? `#link(${typstString(href)})[${content}]` : content;
    }
    default: return unsupported(`mark:${String((m as { type: unknown }).type)}`);
  }
}

/** Inline content. `lineStart` says the first text begins a line (list/heading markers are then escaped). */
export function inline(nodes: DocNode[] | undefined, ctx: Ctx, lineStart: boolean, inFootnote = false): string {
  let out = "";
  let afterCall = false;
  let atStart = lineStart;
  for (const n of nodes ?? []) {
    if (n.type === "text") {
      if (!n.text) continue;
      const marks = n.marks ?? [];
      if (marks.length === 0) {
        out += escapeMarkup(n.text, { lineStart: atStart, afterCall });
        afterCall = false;
      } else {
        const isCode = marks.some((m) => m.type === "code");
        let s = isCode ? `#raw(${typstString(n.text)})` : escapeMarkup(n.text, { lineStart: true });
        let called = isCode;
        for (const m of marks) {
          const w = wrapMark(s, m);
          called ||= w !== s;
          s = w;
        }
        if (!called) {
          // Only unsafe links: plain text.
          s = escapeMarkup(n.text, { lineStart: atStart, afterCall });
          afterCall = false;
        } else {
          afterCall = true;
        }
        out += s;
      }
      atStart = false;
    } else if (n.type === "footnote") {
      if (inFootnote) throw new PdfExportError("Footnotes cannot be nested");
      const body = (n.content ?? [])
        .map((c) => (c.type === "paragraph" ? inline(c.content, ctx, true, true) : inline([c], ctx, true, true)))
        .join(" ");
      out += `#footnote[${body}]`;
      afterCall = true;
      atStart = false;
    } else {
      unsupported(n.type);
    }
  }
  return out;
}
