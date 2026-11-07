import { countWords } from "@cadabracraft/shared";

/** One scene as the outline lists it. Everything is plain data; no chapter text is carried. */
export interface OutlineScene {
  id: string;
  title: string;
  synopsis: string;
  pov: string;
  /** `outline`, `draft`, `revised`, `final` or empty. */
  status: string;
  label: string;
  /** Target length in words, or null. */
  target: number | null;
  /** The story date (`YYYY-MM-DD`, optionally `THH:MM`), or empty. */
  date: string;
  /** The codex entries in the scene: the id and the name it resolved to (the id itself when the codex has no such entry). */
  cast: { id: string; name: string }[];
  /** Words inside the scene. */
  words: number;
}

export interface OutlineChapter {
  id: string;
  title: string;
  /** Words in the whole chapter, scenes and any text outside them. */
  words: number;
  scenes: OutlineScene[];
}

export interface Outline {
  title: string;
  author: string;
  chapters: OutlineChapter[];
}

/** A page of the book as `buildOutline` reads it. Only `id`, `title` and the scene wrappers of `doc` are used. */
export interface OutlineSource {
  id: string;
  title: string;
  doc: unknown;
}

/** The part of a codex entry the outline needs, to turn a cast id into a name. */
export interface OutlineCodexEntry {
  id: string;
  name: string;
}

interface Node {
  type?: unknown;
  attrs?: Record<string, unknown>;
  content?: unknown;
}

const str = (v: unknown): string => (typeof v === "string" ? v : "");
const children = (n: Node): Node[] =>
  Array.isArray(n.content) ? n.content.filter((c): c is Node => !!c && typeof c === "object") : [];

/** The scenes of one chapter in reading order. A scene never holds another scene, so the walk stops at each one. */
function scenesOf(doc: unknown, codex: Map<string, string>): OutlineScene[] {
  const out: OutlineScene[] = [];
  const visit = (node: Node) => {
    if (node.type === "scene") {
      const a = node.attrs ?? {};
      out.push({
        id: str(a.id),
        title: str(a.title),
        synopsis: str(a.synopsis),
        pov: str(a.pov),
        status: str(a.status),
        label: str(a.label),
        target: typeof a.target === "number" ? a.target : null,
        date: str(a.date),
        cast: (Array.isArray(a.cast) ? a.cast : [])
          .filter((x): x is string => typeof x === "string")
          .map((id) => ({ id, name: codex.get(id) ?? id })),
        words: countWords({ type: "doc", content: node.content }),
      });
      return;
    }
    for (const child of children(node)) visit(child);
  };
  if (doc && typeof doc === "object") visit(doc as Node);
  return out;
}

/**
 * The structure of the book as an outline: each page with its scenes. It reads only the scene wrappers and their notes, so
 * the text of the book never reaches an outline file, and a node the exporters would refuse is simply not looked at.
 */
export function buildOutline(
  book: { title: string; author: string },
  pages: OutlineSource[],
  codex: OutlineCodexEntry[] = [],
): Outline {
  const names = new Map(codex.map((e) => [e.id, e.name]));
  return {
    title: book.title,
    author: book.author,
    chapters: pages.map((p) => ({
      id: p.id,
      title: p.title,
      words: countWords(p.doc),
      scenes: scenesOf(p.doc, names),
    })),
  };
}
