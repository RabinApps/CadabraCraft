import type { ChapterDoc, DocNode } from "@cadabracraft/shared";
import { UnsupportedNodeError } from "./errors";

/** A unit of speech. A `pause` has no text; it is a longer silence (scene break). */
export type NarrationBlock =
  { type: "paragraph" | "heading"; text: string } | { type: "pause"; text: "" };

export interface Narration {
  blocks: NarrationBlock[];
  /** Nodes that are not read aloud, by type, so the dialog can say what was left out. */
  skipped: Record<string, number>;
}

const SPOKEN_BLOCKS = new Set(["paragraph", "heading"]);
const CONTAINERS = new Set(["doc", "blockquote", "bulletList", "orderedList", "listItem"]);
/** Left out of the audio (not narratable) but known, so they are counted instead of rejected. */
const SKIPPED = new Set([
  "footnote",
  "image",
  "figcaption",
  "codeBlock",
  "table",
  "tableRow",
  "tableCell",
  "tableHeader",
]);

const squash = (s: string): string => s.replace(/\s+/g, " ").trim();

function inline(node: DocNode, skipped: Record<string, number>): string {
  if (node.type === "text") return node.text;
  if ((node.type as string) === "hardBreak") return " ";
  if (SKIPPED.has(node.type)) {
    skipped[node.type] = (skipped[node.type] ?? 0) + 1;
    return "";
  }
  throw new UnsupportedNodeError(node.type);
}

function walk(node: DocNode, out: NarrationBlock[], skipped: Record<string, number>) {
  const { type } = node;
  if (type === "text") return;
  if (SPOKEN_BLOCKS.has(type)) {
    const text = squash((node.content ?? []).map((c) => inline(c, skipped)).join(""));
    if (text) out.push({ type: type as "paragraph" | "heading", text });
    return;
  }
  if (type === "sceneBreak") {
    out.push({ type: "pause", text: "" });
    return;
  }
  if (CONTAINERS.has(type)) {
    for (const child of node.content ?? []) walk(child, out, skipped);
    return;
  }
  if (SKIPPED.has(type)) {
    skipped[type] = (skipped[type] ?? 0) + 1;
    return;
  }
  throw new UnsupportedNodeError(type);
}

/**
 * The speakable text of a chapter, in order. The chapter title is spoken first unless the chapter already opens
 * with a heading that says it. Footnotes, images, code and tables are skipped and counted; unknown nodes throw.
 */
export function narrate(doc: ChapterDoc, title?: string): Narration {
  const blocks: NarrationBlock[] = [];
  const skipped: Record<string, number> = {};
  walk(doc, blocks, skipped);
  const first = blocks[0];
  const name = title ? squash(title) : "";
  if (name && !(first?.type === "heading" && first.text.toLowerCase() === name.toLowerCase())) {
    blocks.unshift({ type: "heading", text: name });
  }
  return { blocks, skipped };
}
