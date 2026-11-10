// Back-of-book index tools: list the index built from the marks in the text, mark words as an entry, remove entries.
// The index itself is never stored; an entry is an `indexEntry` mark on the words (see docs/file-format.md).
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { entryFile } from "@cadabracraft/format";
import { collectIndexMarks, isValidIndexTerm, termKey } from "@cadabracraft/shared";
import { describeIndex } from "../indexing/describe";
import { addMarks, stripMarks, type JsonMark, type JsonNode } from "../indexing/marks";
import { readPages, savePages, type Edit } from "../indexing/pages";
import { ToolError } from "../errors";
import { editionOf, findEntry, loadProject, projectRoot } from "../project";
import { type ToolDef, defineTool, withLock } from "../tooling";
import { PATH } from "./project";

export const LANGUAGE = z
  .string()
  .min(1)
  .optional()
  .describe(
    "Edition (language code from cadabra_project_info); default is the source edition. Index entries belong to the edition whose text they are in.",
  );

const text = (v: string | undefined, what: string): string | undefined => {
  if (v !== undefined && !isValidIndexTerm(v))
    throw new ToolError("invalid_input", `${what} must be one line of 1 to 120 characters`);
  return v;
};

export const indexList = defineTool({
  name: "cadabra_index_list",
  title: "List index",
  description:
    "Build the back-of-book index from the indexEntry marks in the text and report it: the settings, every term in index order (letter, hidden = the author left it out, listed = the export would list it), its places (place id, chapterId, chapterTitle, the marked words), its subentries, see and see-also targets, and problems (dangling-see / dangling-see-also: a cross-reference to a term that has no entry; hidden-unused: a hidden term that is not in the book). Place ids are what cadabra_index_remove takes. The index page is only written by the exports when cadabra_index_settings has enabled it.",
  input: { path: PATH, language: LANGUAGE },
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
  run: ({ path, language }, ctx) => {
    const { root, manifest } = loadProject(ctx, path);
    const lang = editionOf(manifest, language).language;
    const index = describeIndex(readPages(root, manifest, lang), manifest, lang);
    return {
      summary: `Index: ${index.termCount} term(s), ${index.placeCount} place(s)${index.problems.length ? `, ${index.problems.length} problem(s)` : ""}`,
      data: index,
    };
  },
});

const freshId = (taken: Set<string>): string => {
  let id: string;
  do id = `ix-${randomUUID().replace(/-/g, "").slice(0, 10)}`;
  while (taken.has(id));
  taken.add(id);
  return id;
};

/** Checks what cadabra_index_add was given and returns the index heading (the term, or the marked words). */
function entryArgs(a: {
  words: string;
  term: string | undefined;
  sub: string | undefined;
  see: string | undefined;
  seeAlso: string | undefined;
  all: boolean | undefined;
  chapterId: string | undefined;
}): string {
  const heading = text(a.term ?? a.words.trim(), "term")!;
  text(a.sub, "sub");
  text(a.see, "see");
  text(a.seeAlso, "seeAlso");
  if (a.see !== undefined && a.seeAlso !== undefined)
    throw new ToolError("invalid_input", "an entry takes see or seeAlso, not both");
  if (a.all !== true && a.chapterId === undefined)
    throw new ToolError("invalid_input", "chapterId is needed unless all is true");
  return heading;
}

export const indexAdd = defineTool({
  name: "cadabra_index_add",
  title: "Add index entry",
  description:
    'Mark words in the text as an index entry: an indexEntry mark with a new place id is put on the exact words (case-sensitive; the text itself does not change). Without all, chapterId is needed and the first occurrence in that chapter that is not marked for this term yet is marked; with all, every such occurrence in the whole book (or only in chapterId, when given). term defaults to the marked text; sub makes it a subentry; see ("See X") or seeAlso ("See also X") turn it into a cross-reference to another term (not both). A target that has no entry of its own shows up as a problem in the result and in cadabra_index_list, it is not refused. Occurrences inside code blocks are skipped. Marking the same words again changes nothing (alreadyMarked). The previous text of every changed chapter is kept under .cadabra/backups/. Fails with text_not_found when the words do not appear.',
  input: {
    path: PATH,
    text: z
      .string()
      .min(1)
      .describe("The exact words to mark, as written in the text (one paragraph)."),
    chapterId: z
      .string()
      .min(1)
      .optional()
      .describe("Chapter id from cadabra_project_info. Required unless all is true."),
    term: z
      .string()
      .optional()
      .describe("The index heading (1 to 120 characters, one line). Default: the marked text."),
    sub: z.string().optional().describe("A subentry under the term."),
    see: z
      .string()
      .optional()
      .describe('Cross-reference: lists the term as "See <see>". The term then needs no page.'),
    seeAlso: z
      .string()
      .optional()
      .describe('Cross-reference: adds "See also <seeAlso>" to the term.'),
    all: z
      .boolean()
      .optional()
      .describe("Mark every occurrence in the book instead of the first one in chapterId."),
    language: LANGUAGE,
  },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
  run: ({ path, text: words, chapterId, term, sub, see, seeAlso, all, language }, ctx) =>
    withLock(projectRoot(ctx, path), () => {
      const { root, manifest } = loadProject(ctx, path);
      const lang = editionOf(manifest, language).language;
      const heading = entryArgs({ words, term, sub, see, seeAlso, all, chapterId });
      if (chapterId !== undefined) {
        const { entry } = findEntry(manifest, chapterId);
        if (!entryFile(entry, lang))
          throw new ToolError(
            "chapter_not_translated",
            `${chapterId} has no text in "${lang}" yet`,
          );
      }
      const pages = readPages(root, manifest, lang);
      const taken = new Set(collectIndexMarks(pages).map((r) => r.place.id));
      const same = (m: JsonMark): boolean =>
        m.type === "indexEntry" &&
        termKey(String(m.attrs!.term)) === termKey(heading) &&
        termKey(String(m.attrs!.sub ?? "")) === termKey(sub ?? "");
      const attrs = {
        term: heading,
        ...(sub === undefined ? {} : { sub }),
        ...(see === undefined ? {} : { see }),
        ...(seeAlso === undefined ? {} : { seeAlso }),
      };
      const edits: Edit[] = [];
      const marked: { id: string; chapterId: string; chapterTitle: string; snippet: string }[] = [];
      let already = 0;
      for (const page of pages.filter((p) => chapterId === undefined || p.id === chapterId)) {
        const r = addMarks(page.doc as JsonNode, {
          find: { texts: [words], caseSensitive: true, wholeWord: false },
          mark: () => ({ type: "indexEntry", attrs: { id: freshId(taken), ...attrs } }),
          done: (marks) => marks.some(same),
          limit: all === true ? Infinity : 1,
          skip: ["codeBlock"],
        });
        already += r.already;
        if (r.placed.length) edits.push({ page, doc: r.doc as Edit["doc"] });
        for (const p of r.placed)
          marked.push({
            id: p.mark.attrs!.id as string,
            chapterId: page.id,
            chapterTitle: page.title,
            snippet: p.snippet,
          });
      }
      if (!marked.length && !already)
        throw new ToolError(
          "text_not_found",
          `"${words}" does not appear in ${chapterId === undefined ? "the book" : chapterId} (the match is case-sensitive and cannot cross paragraphs or code blocks)`,
          { chapterId: chapterId ?? null },
        );
      const chapters = savePages(root, edits);
      const after = describeIndex(
        pages.map((p) => ({ ...p, doc: edits.find((e) => e.page === p)?.doc ?? p.doc })),
        manifest,
        lang,
      );
      return {
        summary: `Marked ${marked.length} place(s) for "${heading}"${already ? ` (${already} already marked)` : ""}`,
        data: {
          term: heading,
          ...(sub === undefined ? {} : { sub }),
          ...(see === undefined ? {} : { see }),
          ...(seeAlso === undefined ? {} : { seeAlso }),
          count: marked.length,
          alreadyMarked: already,
          marked,
          chapters,
          problems: after.problems,
        },
      };
    }),
});

export const indexRemove = defineTool({
  name: "cadabra_index_remove",
  title: "Remove index entries",
  description:
    "Remove index entries: one place by placeId (from cadabra_index_list), or every place of a term (with sub: only that subentry's places). Only the indexEntry marks go; the text stays. The previous text of every changed chapter is kept under .cadabra/backups/. Fails with index_entry_not_found when nothing matches.",
  input: {
    path: PATH,
    placeId: z.string().min(1).optional().describe("One place, from cadabra_index_list."),
    term: z
      .string()
      .min(1)
      .optional()
      .describe("Every place of this term (compared without case, accents or extra spaces)."),
    sub: z.string().min(1).optional().describe("With term: only the places under this subentry."),
    language: LANGUAGE,
  },
  annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false },
  run: ({ path, placeId, term, sub, language }, ctx) =>
    withLock(projectRoot(ctx, path), () => {
      if ((placeId === undefined) === (term === undefined))
        throw new ToolError("invalid_input", "give placeId or term (one of them)");
      if (sub !== undefined && term === undefined)
        throw new ToolError("invalid_input", "sub goes with term");
      const { root, manifest } = loadProject(ctx, path);
      const lang = editionOf(manifest, language).language;
      const pages = readPages(root, manifest, lang);
      const found = collectIndexMarks(pages).filter((r) =>
        placeId === undefined
          ? termKey(r.term) === termKey(term!) &&
            (sub === undefined || termKey(r.sub ?? "") === termKey(sub))
          : r.place.id === placeId,
      );
      if (!found.length)
        throw new ToolError(
          "index_entry_not_found",
          `no index entry matches ${placeId === undefined ? `term "${term}"${sub === undefined ? "" : ` / "${sub}"`}` : `place ${placeId}`}; ids and terms come from cadabra_index_list`,
        );
      const ids = new Set(found.map((r) => r.place.id));
      const edits: Edit[] = [];
      for (const page of pages) {
        const r = stripMarks(
          page.doc as JsonNode,
          (m) => m.type === "indexEntry" && ids.has(m.attrs!.id as string),
        );
        if (r.removed.length) edits.push({ page, doc: r.doc as Edit["doc"] });
      }
      const chapters = savePages(root, edits);
      return {
        summary: `Removed ${found.length} index place(s)`,
        data: {
          count: found.length,
          removed: found.map((r) => ({
            id: r.place.id,
            term: r.term,
            ...(r.sub === undefined ? {} : { sub: r.sub }),
            chapterId: r.place.chapterId,
            snippet: r.place.snippet,
          })),
          chapters,
        },
      };
    }),
});

export const bookIndexTools: ToolDef[] = [indexList, indexAdd, indexRemove];
