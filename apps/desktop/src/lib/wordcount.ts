interface Node {
  type?: string;
  text?: string;
  content?: Node[];
}

function collect(node: Node, out: string[]) {
  if (typeof node.text === "string") out.push(node.text);
  // Every non-text node (blocks, footnotes, breaks) separates words; marks only wrap text nodes.
  const split = node.type !== undefined && node.type !== "text";
  if (split) out.push(" ");
  for (const child of node.content ?? []) collect(child, out);
  if (split) out.push(" ");
}

/** Counts whitespace-separated words in TipTap JSON, including headings and footnote text. */
export function countWords(doc: unknown): number {
  if (!doc || typeof doc !== "object") return 0;
  const out: string[] = [];
  collect(doc as Node, out);
  return out.join("").split(/\s+/).filter(Boolean).length;
}
