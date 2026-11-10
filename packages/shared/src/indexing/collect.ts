import type { IndexMarkRef, IndexSource } from "./types";

interface RawMark {
  type?: string;
  attrs?: Record<string, unknown>;
}
interface RawNode {
  type?: string;
  text?: string;
  marks?: RawMark[];
  content?: RawNode[];
}

const str = (v: unknown): string | undefined => (typeof v === "string" && v ? v : undefined);

/**
 * Every `indexEntry` mark of the book, in reading order. A mark spread over several text nodes (bold in the middle of the
 * marked words) is one place; the marked words are joined into its snippet. Anything that is not text (a line break, the
 * end of a paragraph) ends the places that were open.
 */
export function collectIndexMarks(chapters: readonly IndexSource[]): IndexMarkRef[] {
  const out: IndexMarkRef[] = [];
  chapters.forEach((chapter, chapterIndex) => {
    let order = 0;
    let open = new Map<string, IndexMarkRef>();
    const walk = (n: RawNode) => {
      if (n.type === "text") {
        const here = new Map<string, IndexMarkRef>();
        for (const m of n.marks ?? []) {
          const id = str(m.attrs?.id);
          const term = str(m.attrs?.term);
          if (m.type !== "indexEntry" || !id || !term) continue;
          let ref = open.get(id);
          if (!ref) {
            ref = {
              term,
              sub: str(m.attrs?.sub),
              see: str(m.attrs?.see),
              seeAlso: str(m.attrs?.seeAlso),
              place: { id, chapterId: chapter.id, chapterIndex, order: order++, snippet: "" },
            };
            out.push(ref);
          }
          ref.place.snippet += n.text ?? "";
          here.set(id, ref);
        }
        open = here;
        return;
      }
      open = new Map();
      for (const c of n.content ?? []) walk(c);
      open = new Map();
    };
    walk(chapter.doc as RawNode);
  });
  return out;
}
