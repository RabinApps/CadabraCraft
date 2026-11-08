/**
 * Text pieces for the local analysis report (Q06): paragraphs from TipTap JSON, sentences, words and syllables.
 * Pure functions, no network and no AI. The rules are simple on purpose; the report says so.
 */

interface TextNode {
  type?: unknown;
  text?: unknown;
  content?: unknown;
}

function isNode(value: unknown): value is TextNode {
  return !!value && typeof value === "object";
}

/** The text of one block: its text nodes in order, looking inside inline nodes (links, footnotes) but not into nested blocks. */
function inlineText(node: TextNode): string {
  if (typeof node.text === "string") return node.text;
  if (!Array.isArray(node.content)) return "";
  return node.content.filter(isNode).map(inlineText).join("");
}

/**
 * The text of each paragraph-like block (paragraphs, headings, quotes, list items), in reading order. A node with text
 * children is one block; any other node is walked into. Empty blocks are skipped. Works on a chapter or a whole book.
 */
export function blockTexts(doc: unknown): string[] {
  if (!isNode(doc)) return [];
  const out: string[] = [];
  const walk = (node: TextNode) => {
    if (!Array.isArray(node.content)) return;
    const children = node.content.filter(isNode);
    if (children.some((c) => c.type === "text")) {
      const text = inlineText(node).trim();
      if (text) out.push(text);
      return;
    }
    children.forEach(walk);
  };
  walk(doc);
  return out;
}

const SENTENCE_END = /[.!?…]+["'”’)\]]*(?=\s|$)/g;

/** Sentences of a block of text, split after . ! ? or an ellipsis that ends a sentence. */
export function splitSentences(text: string): string[] {
  const out: string[] = [];
  let start = 0;
  for (const m of text.matchAll(SENTENCE_END)) {
    const end = m.index! + m[0].length;
    out.push(text.slice(start, end).trim());
    start = end;
  }
  const rest = text.slice(start).trim();
  if (rest) out.push(rest);
  return out;
}

/** Lower-case words; apostrophes inside a word (don't, Mara's) stay in it, curly apostrophes become straight. */
export function wordsOf(text: string): string[] {
  return (
    text
      .replace(/’/g, "'")
      .toLowerCase()
      .match(/[\p{L}\p{N}]+(?:'[\p{L}\p{N}]+)*/gu) ?? []
  );
}

/** Syllables in one English word, estimated from vowel groups, a silent final e and -ed endings. Never below one. */
export function syllablesOf(word: string): number {
  const w = word.toLowerCase().replace(/[^a-z]/g, "");
  if (w.length === 0) return 0;
  let groups = w.match(/[aeiouy]+/g)?.length ?? 0;
  if (/[^aeiouy]e$/.test(w) && !/(le|ye)$/.test(w) && groups > 1) groups -= 1;
  if (/[^aeiouydt]ed$/.test(w) && groups > 1) groups -= 1;
  return Math.max(1, groups);
}
