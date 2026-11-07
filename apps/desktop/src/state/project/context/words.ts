import { t } from "@lingui/core/macro";
import { readingOrder, sectionOf, entryFile, type Manifest } from "@cadabracraft/format";
import { countWords } from "@cadabracraft/shared";
import { bridge } from "../../../lib/bridge";
import { parseChapter } from "../util";
import type { EntryWords } from "../types";
import type { Get } from "../context";

/** Word counts of the open book, cached per page file and valid while the store's hash for that file is unchanged. */
export function createWords(
  get: Get,
  need: () => { root: string; manifest: Manifest },
  langOf: (manifest: Manifest) => string,
) {
  /** Word count per chapter file, valid while the store's hash for that file is the one it was counted under. */
  let wordCache = new Map<string, { hash: string | undefined; words: number }>();
  /**
   * Words of every page of the book in reading order (front and back matter included, those with no text in the open language
   * left out), reading only pages that changed since they were last counted. The open page is counted from the draft or the
   * loaded doc.
   */
  const countEntries = async (): Promise<EntryWords[]> => {
    const { root, manifest } = need();
    const currentId = get().currentId;
    const lang = langOf(manifest);
    const out: EntryWords[] = [];
    for (const c of readingOrder(manifest)) {
      const section = sectionOf(manifest, c.id)!;
      const own = {
        id: c.id,
        section,
        kind: c.kind,
        verticalCenter: c.verticalCenter,
        startOnNext: c.startOnNext,
      };
      if (c.id === currentId) {
        const open = get().draft ?? get().currentDoc;
        if (open) {
          out.push({ ...own, words: countWords(open) });
          continue;
        }
      }
      const file = entryFile(c, lang);
      // No text in this language yet: the page is still in the book (the PDF exports its title), with no words.
      if (!file) {
        out.push({ ...own, words: 0 });
        continue;
      }
      const hash = get().hashes[file];
      const hit = wordCache.get(file);
      if (hit && hit.hash === hash) {
        out.push({ ...own, words: hit.words });
        continue;
      }
      const r = await bridge.readFile(root, file);
      if (!r) throw new Error(t`Missing chapter file ${file}`);
      const words = countWords(parseChapter(r.contents, file));
      wordCache.set(file, { hash, words });
      out.push({ ...own, words });
    }
    return out;
  };
  /** Words in the book's chapters. */
  const countBook = async () =>
    (await countEntries()).reduce(
      (a, e) => (e.section === "chapter" && e.kind !== "part" ? a + e.words : a),
      0,
    );
  /** Forget every counted page (a different book was opened or the book was closed). */
  const resetWordCache = () => {
    wordCache = new Map();
  };
  /** Forget one page's count (its file changed outside the app). */
  const forgetWords = (path: string) => {
    wordCache.delete(path);
  };
  return { countBook, countEntries, resetWordCache, forgetWords };
}
