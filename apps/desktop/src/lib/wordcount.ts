interface Node {
  type?: string;
  text?: string;
  content?: Node[];
}

/** Types whose neighbours are separate words even without whitespace in the text. */
const breaks = new Set(["footnote", "hardBreak", "sceneBreak"]);

function collect(node: Node, out: string[]) {
  if (typeof node.text === "string") out.push(node.text);
  const split = node.type !== undefined && node.type !== "text";
  if (split) out.push(" ");
  for (const child of node.content ?? []) collect(child, out);
  if (split || (node.type && breaks.has(node.type))) out.push(" ");
}

/** Counts whitespace-separated words in TipTap JSON, including headings and footnote text. */
export function countWords(doc: unknown): number {
  if (!doc || typeof doc !== "object") return 0;
  const out: string[] = [];
  collect(doc as Node, out);
  return out.join("").split(/\s+/).filter(Boolean).length;
}
