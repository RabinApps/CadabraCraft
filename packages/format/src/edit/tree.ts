import type { EditionEntry, Manifest } from "../manifest";

// ---- history snapshots -----------------------------------------------------------------------------

/** The part of the manifest that chapter-tree edits change. Undo restores this and nothing else (editions, template... stay). */
export interface Tree {
  frontMatter: EditionEntry[];
  chapters: EditionEntry[];
  backMatter: EditionEntry[];
}

export const treeOf = (m: Manifest): Tree => ({
  frontMatter: m.frontMatter,
  chapters: m.chapters,
  backMatter: m.backMatter,
});

export const withTree = (m: Manifest, tree: Tree): Manifest => ({ ...m, ...tree });

export const sameTree = (a: Tree, b: Tree): boolean => JSON.stringify(a) === JSON.stringify(b);

/**
 * Points the entry whose `language` file is `from` at `to` (a restored file that had to take another name).
 * Restored files are source files, so callers pass the source language.
 */
export function retargetFile(tree: Tree, language: string, from: string, to: string): Tree {
  const fix = (list: EditionEntry[]) =>
    list.map((e) =>
      e.files[language] === from ? { ...e, files: { ...e.files, [language]: to } } : e,
    );
  return {
    frontMatter: fix(tree.frontMatter),
    chapters: fix(tree.chapters),
    backMatter: fix(tree.backMatter),
  };
}
