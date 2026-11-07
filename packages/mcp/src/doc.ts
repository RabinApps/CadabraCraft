import { assertChapterDoc, chapterDocProblem } from "@cadabracraft/editor-schema";
import { collectImageSources } from "@cadabracraft/export-epub";
import { isAssetPath, type ChapterDoc } from "@cadabracraft/shared";

/** Why `doc` is not a valid chapter in the real editor schema (the one the app and exporters use), or null if it is valid. */
export const schemaProblem = chapterDocProblem;

/** Image `src` values used by a (schema-valid) chapter, in document order, without duplicates. */
export function imageSources(doc: unknown): string[] {
  assertChapterDoc(doc);
  return collectImageSources(doc);
}

/** Image sources that are not project-relative `assets/<file>` paths. */
export const badImageSources = (doc: unknown): string[] =>
  imageSources(doc).filter((s) => !isAssetPath(s));

interface N {
  type?: string;
  text?: string;
  attrs?: Record<string, unknown>;
  content?: N[];
}

const inline = (n: N): string => {
  if (typeof n.text === "string") return n.text;
  if (n.type === "footnote") return ` [note: ${(n.content ?? []).map(inline).join("")}] `;
  return (n.content ?? []).map(inline).join("");
};

/** The children of a list item: the first after `lead` on the item's line, the rest indented below it. */
const itemBlocks = (children: N[] | undefined, indent: string, lead: string): string =>
  (children ?? [])
    .map((b, j) =>
      j === 0 ? `${indent}${lead}${block(b, indent + "  ").trimStart()}` : block(b, indent + "  "),
    )
    .join("\n");

const linesOf = (n: N, fn: (child: N, i: number) => string): string =>
  (n.content ?? []).map(fn).join("\n");

const listBlock = (n: N, indent: string): string => {
  const start = Number(n.attrs?.start ?? 1);
  return linesOf(n, (li, i) =>
    itemBlocks(li.content, indent, n.type === "bulletList" ? "- " : `${start + i}. `),
  );
};

const taskListBlock = (n: N, indent: string): string =>
  linesOf(n, (li) =>
    itemBlocks(li.content, indent, `- [${li.attrs?.checked === true ? "x" : " "}] `),
  );

// The term on a line, then each description as ": text" (further blocks of a description indented below it).
const definitionListBlock = (n: N, indent: string): string =>
  linesOf(n, (k) =>
    k.type === "definitionTerm" ? `${indent}${inline(k)}` : itemBlocks(k.content, indent, ": "),
  );

const blockquoteBlock = (n: N, indent: string): string =>
  (n.content ?? [])
    .map((b) => block(b, indent))
    .join("\n\n")
    .replace(/^/gm, `${indent}> `);

const codeBlock = (n: N, indent: string): string => {
  const lang = typeof n.attrs?.language === "string" ? n.attrs.language : "";
  return [
    `${indent}\`\`\`${lang}`,
    ...(n.content ?? [])
      .map(inline)
      .join("")
      .split("\n")
      .map((l) => indent + l),
    `${indent}\`\`\``,
  ].join("\n");
};

// One line per row, cells separated by " | " (paragraphs within a cell are joined by a space).
const tableBlock = (n: N, indent: string): string =>
  linesOf(
    n,
    (row) =>
      `${indent}${(row.content ?? []).map((c) => (c.content ?? []).map(inline).join(" ").replace(/\s+/g, " ").trim()).join(" | ")}`,
  );

const imageBlock = (n: N, indent: string): string =>
  `${indent}[Image: ${String(n.attrs?.alt ?? "")}]${n.attrs?.title ? ` ${String(n.attrs.title)}` : ""}`;

const BLOCKS: Record<string, (n: N, indent: string) => string> = {
  bulletList: listBlock,
  orderedList: listBlock,
  taskList: taskListBlock,
  definitionList: definitionListBlock,
  blockquote: blockquoteBlock,
  codeBlock,
  sceneBreak: (_n, indent) => `${indent}* * *`,
  // The text the tools hand to a model has no pages: say where the book breaks, the way a scene break is a line of its own.
  pageBreak: (_n, indent) => `${indent}[page break]`,
  table: tableBlock,
  image: imageBlock,
};

function block(n: N, indent = ""): string {
  const render = n.type !== undefined && Object.hasOwn(BLOCKS, n.type) ? BLOCKS[n.type] : undefined;
  return render ? render(n, indent) : `${indent}${inline(n)}`;
}

/** Plain text of a chapter: blocks separated by blank lines, lists as "- " / "1. ", task lists as "- [ ] " / "- [x] ", definitions as a term line then ": text", code blocks fenced, footnotes inline in [note: ...]. */
export function docToText(doc: unknown): string {
  return ((doc as N)?.content ?? [])
    .map((n) => block(n))
    .join("\n\n")
    .trim();
}

/** Replaces image sources per `map` (null removes the image and leaves its alt text), without mutating the input. */
export function remapImages(doc: ChapterDoc, map: Map<string, string | null>): ChapterDoc {
  const walk = (n: unknown): unknown => {
    if (!n || typeof n !== "object") return n;
    const node = n as {
      type?: string;
      attrs?: { src?: string; alt?: string | null };
      content?: unknown[];
    };
    if (node.type === "image" && node.attrs?.src && map.has(node.attrs.src)) {
      const to = map.get(node.attrs.src);
      if (to) return { ...node, attrs: { ...node.attrs, src: to } };
      const alt = node.attrs.alt;
      return { type: "paragraph", content: alt ? [{ type: "text", text: `[Image: ${alt}]` }] : [] };
    }
    return node.content ? { ...node, content: node.content.map(walk) } : node;
  };
  return walk(doc) as ChapterDoc;
}

export const emptyChapterDoc = (title: string): ChapterDoc => ({
  type: "doc",
  content: [
    { type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: title }] },
    { type: "paragraph" },
  ],
});
