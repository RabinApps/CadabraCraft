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
export const badImageSources = (doc: unknown): string[] => imageSources(doc).filter((s) => !isAssetPath(s));

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

function block(n: N, indent = ""): string {
  switch (n.type) {
    case "bulletList":
    case "orderedList": {
      const start = Number(n.attrs?.start ?? 1);
      return (n.content ?? [])
        .map((li, i) => {
          const mark = n.type === "bulletList" ? "- " : `${start + i}. `;
          return (li.content ?? []).map((b, j) => (j === 0 ? `${indent}${mark}${block(b, indent + "  ").trimStart()}` : block(b, indent + "  "))).join("\n");
        })
        .join("\n");
    }
    case "blockquote":
      return (n.content ?? []).map((b) => block(b, indent)).join("\n\n").replace(/^/gm, `${indent}> `);
    case "sceneBreak":
      return `${indent}* * *`;
    case "image":
      return `${indent}[Image: ${String(n.attrs?.alt ?? "")}]${n.attrs?.title ? ` ${String(n.attrs.title)}` : ""}`;
    default:
      return `${indent}${inline(n)}`;
  }
}

/** Plain text of a chapter: blocks separated by blank lines, lists as "- " / "1. ", footnotes inline in [note: ...]. */
export function docToText(doc: unknown): string {
  return ((doc as N)?.content ?? []).map((n) => block(n)).join("\n\n").trim();
}

/** Replaces image sources per `map` (null removes the image and leaves its alt text), without mutating the input. */
export function remapImages(doc: ChapterDoc, map: Map<string, string | null>): ChapterDoc {
  const walk = (n: unknown): unknown => {
    if (!n || typeof n !== "object") return n;
    const node = n as { type?: string; attrs?: { src?: string; alt?: string | null }; content?: unknown[] };
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
  content: [{ type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: title }] }, { type: "paragraph" }],
});
