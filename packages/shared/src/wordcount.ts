// Single word-count implementation, shared by the desktop app and project-fs.
interface CountNode {
  type?: unknown;
  text?: unknown;
  content?: unknown;
}

function collect(node: CountNode, out: string[]) {
  if (typeof node.text === "string") out.push(node.text);
  // Every non-text node (blocks, footnotes, breaks) separates words; marks only wrap text nodes.
  const split = node.type !== undefined && node.type !== "text";
  if (split) out.push(" ");
  if (Array.isArray(node.content)) for (const child of node.content) if (child && typeof child === "object") collect(child, out);
  if (split) out.push(" ");
}

/** Counts whitespace-separated words in TipTap JSON, including headings and footnote text. */
export function countWords(doc: unknown): number {
  if (!doc || typeof doc !== "object") return 0;
  const out: string[] = [];
  collect(doc, out);
  return out.join("").split(/\s+/).filter(Boolean).length;
}
