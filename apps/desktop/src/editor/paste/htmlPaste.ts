import { htmlToBlocks, looksLikeHtml } from "@cadabracraft/import-docx";
import type { DocNode } from "@cadabracraft/shared";
import { Fragment, Node as PMNode, Slice, type Schema } from "@tiptap/pm/model";
import type { EditorState, Transaction } from "@tiptap/pm/state";
import type { RawHtmlPaste } from "../../state/view/editorPrefs";

/** How many characters of the pasted text and of the result the dialog shows. */
export const PREVIEW_CHARS = 120;

/**
 * Longest text (in characters) that is checked for HTML and converted. Anything longer is left to the default paste
 * (pasted as plain text) without being scanned, so a multi-megabyte paste never freezes the editor. For "Convert
 * HTML in Selection" a longer selection is refused with a notice.
 */
export const MAX_HTML_CHARS = 1_000_000;

export interface PasteFacts {
  /** The clipboard's text/plain. */
  text: string;
  /** The clipboard also carries text/html (a real browser copy): ProseMirror's own path handles that. */
  hasHtml: boolean;
  /** The caret is in a code block or inline code, where tags are literal. */
  inCode: boolean;
  pref: RawHtmlPaste;
}

/** `looksLikeHtml` that never throws (the converter can throw on pathological input) and skips text over the limit. */
export function safeLooksLikeHtml(text: string): boolean {
  if (text.length > MAX_HTML_CHARS) return false;
  try {
    return looksLikeHtml(text);
  } catch {
    return false;
  }
}

/** What the paste handler does: leave it to the default paste, convert right away, or ask first. */
export function pasteAction({
  text,
  hasHtml,
  inCode,
  pref,
}: PasteFacts): "default" | "convert" | "ask" {
  if (hasHtml || inCode || pref === "text" || !text || !safeLooksLikeHtml(text)) return "default";
  return pref;
}

/** The first `max` characters on one line, with an ellipsis when cut. Control characters become spaces. */
export function truncate(s: string, max = PREVIEW_CHARS): string {
  // Only the head is needed: do not scan a multi-megabyte string.
  const head = s.length > max * 8 ? s.slice(0, max * 8) : s;
  // eslint-disable-next-line no-control-regex -- control characters are stripped on purpose
  const flat = head.replace(/[\s\u0000-\u001f\u007f-\u009f]+/g, " ").trim();
  const chars = [...flat];
  return chars.length > max || head.length < s.length
    ? `${chars.slice(0, max).join("").trimEnd()}…`
    : flat;
}

const BLOCKS = new Set([
  "paragraph",
  "heading",
  "listItem",
  "tableCell",
  "tableHeader",
  "blockquote",
  "codeBlock",
]);

/** The text of nodes with no formatting; blocks are separated by a space. */
export function plainOf(nodes: readonly DocNode[]): string {
  const parts: string[] = [];
  for (const n of nodes) {
    if (n.type === "text") parts.push(n.text ?? "");
    else if (n.type === "footnote") continue;
    else if (n.content) parts.push(plainOf(n.content), BLOCKS.has(n.type) ? " " : "");
  }
  return parts.join("");
}

export interface Converted {
  /** What to insert: inline nodes for a single paragraph (so it fits mid-sentence), otherwise blocks. */
  content: DocNode[];
  warnings: number;
  /** Plain rendering for the dialog preview. */
  preview: string;
}

/** Converts pasted or selected HTML text with the shared converter. Throws what the converter throws. */
export function convertHtmlText(text: string): Converted {
  const { blocks, warnings } = htmlToBlocks(text);
  const only = blocks.length === 1 && blocks[0]!.type === "paragraph" ? blocks[0]! : null;
  return {
    content: only ? (only.content ?? []) : blocks,
    warnings: warnings.length,
    preview: truncate(plainOf(blocks)),
  };
}

/** `convertHtmlText` that returns null instead of throwing (too deeply nested, too large, or any other failure). */
export function tryConvertHtmlText(text: string): Converted | null {
  if (text.length > MAX_HTML_CHARS) return null;
  try {
    return convertHtmlText(text);
  } catch {
    return null;
  }
}

/** The nearest table cell or footnote around a position, as its start; null at the top level or in plain blocks. */
function isolatingStart(state: EditorState, pos: number): number | null {
  const $p = state.doc.resolve(pos);
  for (let d = $p.depth; d > 0; d--)
    if ($p.node(d).type.spec.isolating || $p.node(d).type.name === "footnote") return $p.before(d);
  return null;
}

function inTableCell(state: EditorState, pos: number): boolean {
  const $p = state.doc.resolve(pos);
  for (let d = $p.depth; d > 0; d--)
    if ($p.node(d).type.name === "tableCell" || $p.node(d).type.name === "tableHeader") return true;
  return false;
}

/** True when the range starts and ends in different table cells or footnotes (or only one end is in one): replacing it would tear the table. */
export function crossesCells(state: EditorState, from: number, to: number): boolean {
  if (from === to) return false;
  return isolatingStart(state, from) !== isolatingStart(state, to);
}

/** The text of the nodes on one line, blocks separated by a space: the shape that fits any context. */
function flatText(nodes: readonly DocNode[]): string {
  return plainOf(nodes).replace(/\s+/g, " ").trim();
}

function textParagraphs(nodes: readonly DocNode[]): DocNode[] {
  const out: DocNode[] = [];
  for (const n of nodes) {
    if (n.type === "paragraph") out.push(n);
    else if (n.type === "text") out.push({ type: "paragraph", content: [n] });
    else {
      const t = flatText([n]);
      if (t) out.push({ type: "paragraph", content: [{ type: "text", text: t }] });
    }
  }
  return out;
}

/**
 * The content reshaped so it satisfies the schema where it lands: inside a footnote, heading or code block only inline
 * text; inside a table cell only paragraphs. Elsewhere it is kept as is (the editor splits the paragraph around blocks).
 */
export function fitContent(
  state: EditorState,
  content: readonly DocNode[],
  pos: number,
): DocNode[] {
  const parent = state.doc.resolve(pos).parent.type.name;
  if (parent === "footnote" || parent === "heading" || parent === "codeBlock") {
    // Styled text stays styled in a heading or footnote; only blocks and other nodes are flattened to one text run.
    if (parent !== "codeBlock" && content.length && content.every((n) => n.type === "text"))
      return [...content];
    const t = flatText(content);
    return t ? [{ type: "text", text: t }] : [];
  }
  const inline = content.every((n) => n.type === "text");
  if (!inline && inTableCell(state, pos)) return textParagraphs(content);
  return [...content];
}

function toFragment(schema: Schema, content: readonly DocNode[]): Fragment {
  return Fragment.fromArray(content.map((n) => PMNode.fromJSON(schema, n)));
}

/**
 * A transaction that puts converted content over the range (clamped to the document), or null when nothing can be
 * inserted (empty content, or a range across several table cells). The result is checked against the schema; if the
 * fitted insert would be invalid it falls back to the content's plain text, so a conversion can never leave the
 * document invalid. One transaction is one undo step.
 */
export function insertConverted(
  state: EditorState,
  content: readonly DocNode[],
  range: { from: number; to: number },
): Transaction | null {
  const size = state.doc.content.size;
  const from = Math.max(0, Math.min(range.from, size));
  const to = Math.max(from, Math.min(range.to, size));
  if (crossesCells(state, from, to)) return null;
  const attempt = (nodes: readonly DocNode[]): Transaction | null => {
    if (!nodes.length) return null;
    try {
      const tr = state.tr.replaceRange(from, to, new Slice(toFragment(state.schema, nodes), 0, 0));
      tr.doc.check();
      return tr;
    } catch {
      return null;
    }
  };
  const flat = flatText(content);
  return (
    attempt(fitContent(state, content, from)) ?? attempt(flat ? [{ type: "text", text: flat }] : [])
  );
}

/** The raw text as editor content the way a default paste lands it: one text run, or one paragraph per line. */
export function literalContent(text: string): DocNode[] {
  const lines = text.split(/\r\n?|\n/).filter((l) => l !== "");
  const run = (l: string): DocNode => ({ type: "text", text: l });
  if (lines.length <= 1) return lines.map(run);
  return lines.map((l) => ({ type: "paragraph", content: [run(l)] }));
}
