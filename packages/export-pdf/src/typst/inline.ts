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

/** A mark to write at an offset of one text node (`[offset in the text, the mark's source]`, ascending). */
type Cut = [number, string];

/**
 * Text with a mark in `cuts` at each offset. The pieces are escaped one by one; a piece after a mark is escaped as text that follows a call.
 */
function markedText(
  text: string,
  cuts: Cut[],
  start: { lineStart: boolean; afterCall: boolean },
): string {
  let out = "";
  let from = 0;
  let { lineStart, afterCall } = start;
  for (const [at, mark] of cuts) {
    const piece = text.slice(from, at);
    out += escapeMarkup(piece, { lineStart, afterCall });
    lineStart = lineStart && /^[ \t]*$/.test(piece);
    out += mark;
    afterCall = true;
    from = at;
  }
  return out + escapeMarkup(text.slice(from), { lineStart, afterCall });
}

/** Inline code with a mark in `cuts` at each offset: one `raw` per piece (code is monospace, so the seam changes nothing). */
function markedRaw(text: string, cuts: Cut[]): string {
  let out = "";
  let from = 0;
  for (const [at, mark] of cuts) {
    if (at > from) out += `#raw(${typstString(text.slice(from, at))})`;
    out += mark;
    from = at;
  }
  return `${out}#raw(${typstString(text.slice(from))})`;
}

/** Positions a node takes in the editor's document, the way ProseMirror counts them: a character each for text, 2 more for a node with content. */
export function nodeSize(n: DocNode): number {
  if (n.type === "text") return n.text.length;
  const kids = "content" in n ? n.content : undefined;
  return kids ? 2 + kids.reduce((sum, k) => sum + nodeSize(k), 0) : 1;
}

/**
 * The page marks of a text leaf (`inline`'s `words`): the flat offsets of its word starts (`wordStarts`), the mark written before
 * each word but the first (none when `before` is absent) and the words (`inside.words`) that get a mark between each two of their
 * characters instead, to find where Typst hyphenated them.
 */
export interface WordMarks {
  starts: number[];
  before?: (word: number) => string;
  inside?: { words: ReadonlySet<number>; mark: (word: number, char: number) => string };
}

/**
 * Inline content. `lineStart` says the first text begins a line (list/heading markers are then escaped). `words` is the page-mark
 * request for a text leaf: the text follows a `#bm-s` call, and the marks go where `WordMarks` says.
 */
export function inline(
  nodes: DocNode[] | undefined,
  ctx: Ctx,
  lineStart: boolean,
  inFootnote = false,
  words?: WordMarks,
): string {
  let out = "";
  let afterCall = words !== undefined;
  let atStart = lineStart;
  let offset = 0;
  /** The marks inside the text node `text` that starts at `offset`: before the words that start in it (not the first of the leaf), and inside the words to be taken apart. */
  const cutsIn = (text: string): Cut[] => {
    const cuts: Cut[] = [];
    (words?.starts ?? []).forEach((o, w) => {
      const at = o - offset;
      if (at < 0 || at >= text.length) return;
      if (w >= 1 && words!.before) cuts.push([at, words!.before(w)]);
      if (words!.inside?.words.has(w)) {
        let end = at + 1;
        while (end < text.length && text[end] !== " " && text[end] !== "\t") end++;
        for (let j = 1; at + j < end; j++) cuts.push([at + j, words!.inside.mark(w, j)]);
      }
    });
    return cuts;
  };
  for (const n of nodes ?? []) {
    if (n.type === "text") {
      if (!n.text) continue;
      const marks = n.marks ?? [];
      const cuts = cutsIn(n.text);
      if (marks.length === 0) {
        out += markedText(n.text, cuts, { lineStart: atStart, afterCall });
        afterCall = false;
      } else {
        const isCode = marks.some((m) => m.type === "code");
        let s = isCode
          ? markedRaw(n.text, cuts)
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
      offset += nodeSize(n);
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
