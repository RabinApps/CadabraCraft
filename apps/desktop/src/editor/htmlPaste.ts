import { htmlToBlocks, looksLikeHtml } from "@cadabracraft/import-docx";
import type { DocNode } from "@cadabracraft/shared";
import type { RawHtmlPaste } from "../app/editorPrefs";

/** How many characters of the pasted text and of the result the dialog shows. */
export const PREVIEW_CHARS = 120;

export interface PasteFacts {
  /** The clipboard's text/plain. */
  text: string;
  /** The clipboard also carries text/html (a real browser copy): ProseMirror's own path handles that. */
  hasHtml: boolean;
  /** The caret is in a code block or inline code, where tags are literal. */
  inCode: boolean;
  pref: RawHtmlPaste;
}

/** What the paste handler does: leave it to the default paste, convert right away, or ask first. */
export function pasteAction({ text, hasHtml, inCode, pref }: PasteFacts): "default" | "convert" | "ask" {
  if (hasHtml || inCode || pref === "text" || !text || !looksLikeHtml(text)) return "default";
  return pref;
}

/** The first `max` characters on one line, with an ellipsis when cut. */
export function truncate(s: string, max = PREVIEW_CHARS): string {
  const flat = s.replace(/\s+/g, " ").trim();
  const chars = [...flat];
  return chars.length > max ? `${chars.slice(0, max).join("").trimEnd()}…` : flat;
}

const BLOCKS = new Set(["paragraph", "heading", "listItem", "tableCell", "tableHeader", "blockquote", "codeBlock"]);

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

/** Converts pasted or selected HTML text with the shared converter. */
export function convertHtmlText(text: string): Converted {
  const { blocks, warnings } = htmlToBlocks(text);
  const only = blocks.length === 1 && blocks[0]!.type === "paragraph" ? blocks[0]! : null;
  return { content: only ? (only.content ?? []) : blocks, warnings: warnings.length, preview: truncate(plainOf(blocks)) };
}

/** The raw text as editor content the way a default paste lands it: one text run, or one paragraph per line. */
export function literalContent(text: string): DocNode[] {
  const lines = text.split(/\r\n?|\n/).filter((l) => l !== "");
  const run = (l: string): DocNode => ({ type: "text", text: l });
  if (lines.length <= 1) return lines.map(run);
  return lines.map((l) => ({ type: "paragraph", content: [run(l)] }));
}
