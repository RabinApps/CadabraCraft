import { safeHref, type DocNode, type Mark } from "@cadabracraft/shared";
import { escapeMarkup, typstString } from "../escape";
import { PdfExportError } from "../errors";
import { unsupported, type Ctx } from "./ctx";

function wrapMark(content: string, m: Mark): string {
  switch (m.type) {
    case "bold":
      return `#strong[${content}]`;
    case "italic":
      return `#emph[${content}]`;
    case "underline":
      return `#underline[${content}]`;
    case "smallCaps":
      return `#smallcaps[${content}]`;
    case "strike":
      return `#strike[${content}]`;
    case "superscript":
      return `#super[${content}]`;
    case "subscript":
      return `#sub[${content}]`;
    // Inline code is emitted as a raw string by `inline`, which has the unescaped text.
    case "code":
      return content;
    case "link": {
      const href = m.attrs?.href?.trim() ?? "";
      // Anything but http(s)/mailto keeps its text and loses the link (the href is written as typed, not re-serialized).
      return safeHref(href) === null ? content : `#link(${typstString(href)})[${content}]`;
    }
    default:
      return unsupported(`mark:${String((m as { type: unknown }).type)}`);
  }
}

/**
 * Text with a `#wm(w)` mark before each word start in `cuts` (`[offset in this text, word index]`, ascending). The pieces are escaped
 * one by one; a piece after a mark is escaped as text that follows a call.
 */
function markedText(
  text: string,
  cuts: [number, number][],
  start: { lineStart: boolean; afterCall: boolean },
): string {
  let out = "";
  let from = 0;
  let { lineStart, afterCall } = start;
  for (const [at, w] of cuts) {
    const piece = text.slice(from, at);
    out += escapeMarkup(piece, { lineStart, afterCall });
    lineStart = lineStart && /^[ \t]*$/.test(piece);
    out += `#wm(${w})`;
    afterCall = true;
    from = at;
  }
  return out + escapeMarkup(text.slice(from), { lineStart, afterCall });
}

/**
 * Inline content. `lineStart` says the first text begins a line (list/heading markers are then escaped). `words` is the page-mark
 * request for a block: the text follows a `#bm-s` call, and a `#wm(w)` mark goes before every word start but the first (`starts` are
 * the flat offsets from `wordStarts`, empty to mark none).
 */
export function inline(
  nodes: DocNode[] | undefined,
  ctx: Ctx,
  lineStart: boolean,
  inFootnote = false,
  words?: { starts: number[] },
): string {
  let out = "";
  let afterCall = words !== undefined;
  let atStart = lineStart;
  let offset = 0;
  const cutsIn = (len: number): [number, number][] =>
    (words?.starts ?? [])
      .map((o, w): [number, number] => [o - offset, w])
      .filter(([at, w]) => w >= 1 && at >= 0 && at < len);
  for (const n of nodes ?? []) {
    if (n.type === "text") {
      if (!n.text) continue;
      const marks = n.marks ?? [];
      const cuts = cutsIn(n.text.length);
      if (marks.length === 0) {
        out += markedText(n.text, cuts, { lineStart: atStart, afterCall });
        afterCall = false;
      } else {
        const isCode = marks.some((m) => m.type === "code");
        let s = isCode
          ? `#raw(${typstString(n.text)})`
          : markedText(n.text, cuts, { lineStart: true, afterCall: false });
        let called = isCode;
        for (const m of marks) {
          const w = wrapMark(s, m);
          called ||= w !== s;
          s = w;
        }
        if (!called) {
          // Only unsafe links: plain text.
          s = markedText(n.text, cuts, { lineStart: atStart, afterCall });
          afterCall = false;
        } else {
          afterCall = true;
        }
        out += s;
      }
      atStart = false;
      offset += n.text.length;
    } else if (n.type === "footnote") {
      if (inFootnote) throw new PdfExportError("Footnotes cannot be nested");
      const body = (n.content ?? [])
        .map((c) =>
          c.type === "paragraph"
            ? inline(c.content, ctx, true, true)
            : inline([c], ctx, true, true),
        )
        .join(" ");
      out += `#footnote[${body}]`;
      afterCall = true;
      atStart = false;
    } else if (n.type === "hardBreak") {
      out += "\\\n"; // Typst line break; the next text starts a line, so list markers are escaped again
      afterCall = false;
      atStart = true;
      offset += 1;
    } else {
      unsupported(n.type);
    }
  }
  return out;
}
