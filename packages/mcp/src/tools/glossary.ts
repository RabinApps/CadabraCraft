// Glossary tools: the entries live in the manifest (a definition is the author's writing), a use of a term in the text is a
// `glossaryTerm` mark with the entry's id (see docs/file-format.md).
import { z } from "zod";
import {
  defaultGlossarySettings,
  validateGlossarySettings,
  type GlossarySettings,
  type Manifest,
} from "@cadabracraft/format";
import {
  buildGlossary,
  collectGlossaryUses,
  errMsg,
  isValidGlossaryId,
  termKey,
  type GlossaryEntry,
} from "@cadabracraft/shared";
import { ToolError } from "../errors";
import { addMarks, stripMarks, type JsonMark, type JsonNode } from "../indexing/marks";
import { readPages, savePages, type Edit, type Saved } from "../indexing/pages";
import { editionOf, loadProject, projectRoot, saveManifest } from "../project";
import { type ToolDef, defineTool, withLock } from "../tooling";
import { LANGUAGE } from "./bookIndex";
import { PATH } from "./project";

const settingsOf = (m: Manifest): GlossarySettings => m.glossary ?? defaultGlossarySettings();

export const glossaryList = defineTool({
  name: "cadabra_glossary_list",
  title: "List glossary",
  description:
    "The glossary: its settings and every entry (id, term, aliases, definition, hasDefinition) with how often it is used in the text (uses, the chapters that use it) and problems (unknown-entry: a glossaryTerm mark names an id that has no entry, id = that id; no-definition: the entry has none, so the exports leave it out; duplicate-term: two entries have the same term). Entries are in the glossary's order (alphabetical for the book's language, or as added).",
  input: { path: PATH, language: LANGUAGE },
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
  run: ({ path, language }, ctx) => {
    const { root, manifest } = loadProject(ctx, path);
    const lang = editionOf(manifest, language).language;
    const pages = readPages(root, manifest, lang);
    const titles = new Map(pages.map((p) => [p.id, p.title]));
    const settings = settingsOf(manifest);
    const built = buildGlossary(settings.entries, collectGlossaryUses(pages), {
      locale: lang,
      order: settings.order,
      includeUndefined: true,
    });
    const entries = built.items.map(({ entry, use }) => ({
      ...entry,
      hasDefinition: entry.definition.trim() !== "",
      uses: use?.count ?? 0,
      chapters: (use?.chapterIds ?? []).map((id) => ({ id, title: titles.get(id)! })),
    }));
    const { enabled, heading, order, inIndex, markFirstUse, showUndefined } = settings;
    return {
      summary: `Glossary: ${entries.length} entr${entries.length === 1 ? "y" : "ies"}${built.problems.length ? `, ${built.problems.length} problem(s)` : ""}`,
      data: {
        language: lang,
        settings: { enabled, heading, order, inIndex, markFirstUse, showUndefined },
        entries,
        problems: built.problems,
      },
    };
  },
});

const MARK = z
  .enum(["none", "first", "all"])
  .optional()
  .describe(
    'Mark the term and its aliases in the text of the edition given by language: "none" (default), "first" (the first use in each chapter that does not use the entry yet) or "all" (every use in the book). Whole words, any case; headings and code blocks are skipped. A use that is already marked is left alone.',
  );

/** Puts `glossaryTerm` marks on the entry's term and aliases in the pages of `language`; the manifest is already saved. */
function markUses(
  root: string,
  manifest: Manifest,
  language: string,
  entry: GlossaryEntry,
  mode: "none" | "first" | "all",
): { count: number; chapters: Saved[] } {
  if (mode === "none") return { count: 0, chapters: [] };
  const edits: Edit[] = [];
  let count = 0;
  for (const page of readPages(root, manifest, language)) {
    if (mode === "first" && collectGlossaryUses([page]).has(entry.id)) continue;
    const r = addMarks(page.doc as JsonNode, {
      find: {
        texts: [entry.term, ...(entry.aliases ?? [])],
        caseSensitive: false,
        wholeWord: true,
      },
      mark: () => ({ type: "glossaryTerm", attrs: { id: entry.id } }),
      done: (marks) => marks.some((m) => m.type === "glossaryTerm" && m.attrs!.id === entry.id),
      limit: mode === "all" ? Infinity : 1,
      skip: ["codeBlock", "heading"],
    });
    if (r.placed.length) edits.push({ page, doc: r.doc as Edit["doc"] });
    count += r.placed.length;
  }
  return { count, chapters: savePages(root, edits) };
}

/** Refuses a term that another entry already has (compared without case, accents or extra spaces). */
function ensureFree(entries: GlossaryEntry[], entry: GlossaryEntry): void {
  const other = entries.find((e) => e.id !== entry.id && termKey(e.term) === termKey(entry.term));
  if (other)
    throw new ToolError(
      "glossary_entry_exists",
      `the glossary already has the term "${entry.term}" (entry ${other.id})`,
      { id: other.id },
    );
}

/** `entries` as new settings, or an invalid_input error naming what is wrong (limits, ids, aliases). */
function withEntries(settings: GlossarySettings, entries: GlossaryEntry[]): GlossarySettings {
  try {
    return validateGlossarySettings({ ...settings, entries });
  } catch (e) {
    // The validators only throw FormatError: every one of them is a problem with what the caller sent.
    throw new ToolError("invalid_input", errMsg(e));
  }
}

/** A readable id for a term ("Mana well" is "mana-well"): a letter first, unique among `taken`. */
function idFor(term: string, taken: Set<string>): string {
  const slug = term
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 56);
  const base = /^[a-z]/.test(slug) ? slug : `term-${slug}`.replace(/-$/, "");
  let id = base;
  for (let n = 2; taken.has(id); n++) id = `${base}-${n}`;
  return id;
}

const unknownEntry = (id: string): ToolError =>
  new ToolError(
    "glossary_entry_not_found",
    `no glossary entry with id "${id}"; ids come from cadabra_glossary_list`,
    { id },
  );

const ALIASES = z
  .array(z.string())
  .optional()
  .describe(
    "Other spellings and plurals found in the text (up to 12, each 1 to 120 characters, one line).",
  );

const saveEntries = (root: string, manifest: Manifest, hash: string, glossary: GlossarySettings) =>
  saveManifest(root, { ...manifest, glossary }, hash);

export const glossaryAdd = defineTool({
  name: "cadabra_glossary_add",
  title: "Add glossary entry",
  description:
    'Add an entry to the glossary in cadabra.json: term (1 to 120 characters, one line), definition (up to 2000 characters; may be empty for now, but an entry with no definition is left out of the exports), optional aliases and id (default: made from the term, e.g. "mana-well"). The term must not be in the glossary already (glossary_entry_exists, compared without case or accents). mark also puts glossaryTerm marks on the uses of the term and its aliases in the text (the manifest is saved first, then the chapters, each with its previous text kept under .cadabra/backups/). Turn the glossary page on with cadabra_glossary_settings.',
  input: {
    path: PATH,
    term: z.string().min(1).describe("The term, as it is listed."),
    definition: z
      .string()
      .optional()
      .describe("The definition; blank lines start a new paragraph."),
    aliases: ALIASES,
    id: z
      .string()
      .optional()
      .describe("Entry id: a letter, then letters, digits, _ or -, at most 64 characters."),
    mark: MARK,
    language: LANGUAGE,
  },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
  run: ({ path, term, definition, aliases, id, mark, language }, ctx) =>
    withLock(projectRoot(ctx, path), () => {
      const { root, manifest, hash } = loadProject(ctx, path);
      const lang = editionOf(manifest, language).language;
      const settings = settingsOf(manifest);
      const taken = new Set(settings.entries.map((e) => e.id));
      if (id !== undefined && !isValidGlossaryId(id))
        throw new ToolError(
          "invalid_input",
          "id must be a letter, then letters, digits, _ or -, at most 64 characters",
        );
      if (id !== undefined && taken.has(id))
        throw new ToolError(
          "glossary_entry_exists",
          `the glossary already has an entry with id "${id}"`,
          { id },
        );
      const entry: GlossaryEntry = {
        id: id ?? idFor(term, taken),
        term,
        ...(aliases === undefined ? {} : { aliases }),
        definition: definition ?? "",
      };
      ensureFree(settings.entries, entry);
      const next = withEntries(settings, [...settings.entries, entry]);
      const w = saveEntries(root, manifest, hash, next);
      const marked = markUses(root, manifest, lang, entry, mark ?? "none");
      return {
        summary: `Added glossary entry ${entry.id} "${term}"${marked.count ? `; marked ${marked.count} use(s)` : ""}`,
        data: {
          entry,
          hasDefinition: entry.definition.trim() !== "",
          marked: marked.count,
          chapters: marked.chapters,
          manifestHash: w.hash,
          conflictCopy: w.conflictCopy,
        },
      };
    }),
});

export const glossaryUpdate = defineTool({
  name: "cadabra_glossary_update",
  title: "Update glossary entry",
  description:
    "Change a glossary entry by id: term, definition and/or aliases (replaces the list; an empty list removes the aliases). Marks in the text name the entry by id, so a new term needs no re-marking. mark puts glossaryTerm marks on the uses of the (new) term and aliases, like cadabra_glossary_add. Fails with glossary_entry_not_found for an unknown id and glossary_entry_exists when the new term belongs to another entry.",
  input: {
    path: PATH,
    id: z.string().min(1).describe("Entry id from cadabra_glossary_list."),
    term: z.string().min(1).optional().describe("New term."),
    definition: z.string().optional().describe("New definition (an empty string clears it)."),
    aliases: ALIASES,
    mark: MARK,
    language: LANGUAGE,
  },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
  run: ({ path, id, term, definition, aliases, mark, language }, ctx) =>
    withLock(projectRoot(ctx, path), () => {
      const { root, manifest, hash } = loadProject(ctx, path);
      const lang = editionOf(manifest, language).language;
      const settings = settingsOf(manifest);
      const old = settings.entries.find((e) => e.id === id);
      if (!old) throw unknownEntry(id);
      const kept = aliases === undefined ? old.aliases : aliases;
      const entry: GlossaryEntry = {
        id,
        term: term ?? old.term,
        ...(kept?.length ? { aliases: kept } : {}),
        definition: definition ?? old.definition,
      };
      ensureFree(settings.entries, entry);
      const next = withEntries(
        settings,
        settings.entries.map((e) => (e.id === id ? entry : e)),
      );
      const changed = JSON.stringify(entry) !== JSON.stringify(old);
      const w = changed ? saveEntries(root, manifest, hash, next) : null;
      const marked = markUses(root, manifest, lang, entry, mark ?? "none");
      return {
        summary: `${changed ? "Updated" : "No change to"} glossary entry ${id}${marked.count ? `; marked ${marked.count} use(s)` : ""}`,
        data: {
          entry,
          changed,
          marked: marked.count,
          chapters: marked.chapters,
          manifestHash: w?.hash ?? hash,
          conflictCopy: w?.conflictCopy ?? null,
        },
      };
    }),
});

export const glossaryRemove = defineTool({
  name: "cadabra_glossary_remove",
  title: "Remove glossary entry",
  description:
    "Remove a glossary entry by id and every glossaryTerm mark that names it, in every edition (the text stays; the previous text of every changed chapter is kept under .cadabra/backups/). The chapters are written first, then cadabra.json. An id that has no entry but still has marks in the text (listed as unknown-entry by cadabra_glossary_list) removes just those marks. Fails with glossary_entry_not_found when there is neither.",
  input: { path: PATH, id: z.string().min(1).describe("Entry id from cadabra_glossary_list.") },
  annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false },
  run: ({ path, id }, ctx) =>
    withLock(projectRoot(ctx, path), () => {
      const { root, manifest, hash } = loadProject(ctx, path);
      const settings = settingsOf(manifest);
      const entry = settings.entries.find((e) => e.id === id);
      const chapters: Saved[] = [];
      let marks = 0;
      for (const { language } of manifest.editions) {
        const edits: Edit[] = [];
        for (const page of readPages(root, manifest, language)) {
          const r = stripMarks(
            page.doc as JsonNode,
            (m: JsonMark) => m.type === "glossaryTerm" && m.attrs!.id === id,
          );
          if (r.removed.length) edits.push({ page, doc: r.doc as Edit["doc"] });
          marks += r.removed.length;
        }
        chapters.push(...savePages(root, edits));
      }
      if (!entry && !marks) throw unknownEntry(id);
      const w = entry
        ? saveEntries(
            root,
            manifest,
            hash,
            withEntries(
              settings,
              settings.entries.filter((e) => e.id !== id),
            ),
          )
        : null;
      return {
        summary: `Removed glossary entry ${id}${entry ? ` "${entry.term}"` : ""}; ${marks} mark(s) taken out of the text`,
        data: {
          removed: entry ?? null,
          marksRemoved: marks,
          chapters,
          manifestHash: w?.hash ?? hash,
          conflictCopy: w?.conflictCopy ?? null,
        },
      };
    }),
});

export const glossaryTools: ToolDef[] = [glossaryList, glossaryAdd, glossaryUpdate, glossaryRemove];
