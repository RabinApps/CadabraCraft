import type { DocNode } from "@cadabracraft/shared";
import {
  addChapter,
  addFrontMatter,
  addBackMatter,
  createManifest,
  resolveToc,
  type EditionEntry,
  type Manifest,
  type OutlineItem,
  type Outlines,
  type TocItem,
} from "../index";

export const base = () => createManifest({ title: "T", author: "A", identifier: "urn:uuid:x" });

/** A book with a title page, a contents page, three chapters and a colophon. */
export function book(): { m: Manifest; toc: string; ch: string[] } {
  let m = base();
  m = addFrontMatter(m, "title-page", "Title").manifest;
  const c = addFrontMatter(m, "contents", "Contents");
  m = c.manifest;
  const ch: string[] = [];
  for (const t of ["One", "Two", "Three"]) {
    const r = addChapter(m, t);
    m = r.manifest;
    ch.push(r.entry.id);
  }
  m = addBackMatter(m, "colophon", "Colophon").manifest;
  m = addBackMatter(m, "about-the-author", "About").manifest;
  return { m, toc: c.entry.id, ch };
}

export const entryOf = (m: Manifest, id: string): EditionEntry =>
  m.frontMatter.find((e) => e.id === id)!;
export const keysOf = (items: readonly TocItem[]) => items.map((i) => i.key);
export const resolve = (m: Manifest, id: string, outlines: Outlines = {}, lang = "en") =>
  resolveToc(m, entryOf(m, id), lang, outlines);

export const o = (index: number, level: number, text: string): OutlineItem => ({
  index,
  level,
  text,
});
export function heading(level: number, text: string): DocNode {
  return {
    type: "heading",
    attrs: { level },
    ...(text ? { content: [{ type: "text", text }] } : {}),
  };
}
