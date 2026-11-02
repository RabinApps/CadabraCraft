// Table of contents tools: read the resolved contents list and change the Contents page's settings and overrides.
// The list itself is generated (packages/format toc.ts); the manifest only keeps depth, page numbers and the author's overrides.
import { rmSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import {
  addFrontMatter,
  addTocCustom,
  canAddMatter,
  entryFile,
  extractOutline,
  hideTocItem,
  moveTocItem,
  readingOrder,
  removeTocOverride,
  renameTocItem,
  resetToc,
  resolveToc,
  setTocDepth,
  setTocPageNumbers,
  showTocItem,
  sourceEdition,
  staleOverrides,
  starterDoc,
  starterTitle,
  tocSettingsOf,
  TOC_UNLISTED_KINDS,
  type EditionEntry,
  type Manifest,
  type Outlines,
  type TocDepth,
} from "@cadabracraft/format";
import type { ChapterDoc } from "@cadabracraft/shared";
import { readProjectFile, writeProjectFile } from "@cadabracraft/project-fs";
import { ToolError } from "../errors";
import { editionOf, loadProject, projectRoot, readChapterFile, saveManifest } from "../project";
import { type ToolDef, defineTool, withLock } from "../tooling";
import { PATH } from "./project";

const LANGUAGE = z
  .string()
  .min(1)
  .optional()
  .describe("Edition (language code from cadabra_project_info); default is the source edition.");

const contentsPage = (m: Manifest): EditionEntry => {
  const entry = m.frontMatter.find((e) => e.kind === "contents");
  if (!entry)
    throw new ToolError(
      "toc_no_contents_page",
      'the book has no Contents page; add one with cadabra_toc_update (action "add_page")',
    );
  return entry;
};

/** The outline of every listed page in `language` (read only when the depth lists headings; a page with no text in that language lists none). */
function readOutlines(root: string, m: Manifest, entry: EditionEntry, language: string): Outlines {
  const outlines: Record<string, ReturnType<typeof extractOutline>> = {};
  if (tocSettingsOf(entry).depth === 0) return outlines;
  for (const e of readingOrder(m)) {
    if (e.kind === "contents" || (e.kind !== undefined && TOC_UNLISTED_KINDS.includes(e.kind)))
      continue;
    const file = entryFile(e, language);
    if (file) outlines[e.id] = extractOutline(readChapterFile(root, file).doc as ChapterDoc);
  }
  return outlines;
}

/** The Contents page as the tools report it: settings, resolved items (hidden ones flagged) and overrides that no longer resolve. */
function describeToc(root: string, m: Manifest, language: string) {
  const entry = contentsPage(m);
  const items = resolveToc(m, entry, language, readOutlines(root, m, entry, language));
  const t = tocSettingsOf(entry);
  return {
    contentsId: entry.id,
    language,
    settings: { depth: t.depth, pageNumbers: t.pageNumbers },
    items: items.map((i) => ({
      key: i.key,
      kind: i.kind,
      level: i.level,
      title: i.title,
      renamed: i.renamed,
      hidden: i.hidden,
      ...(i.entryId === undefined ? {} : { entryId: i.entryId }),
      ...(i.index === undefined ? {} : { index: i.index }),
      ...(i.target === undefined ? {} : { target: i.target }),
      ...(i.stale ? { stale: true } : {}),
    })),
    stale: staleOverrides(entry, items),
  };
}

export const tocGet = defineTool({
  name: "cadabra_toc_get",
  title: "Get table of contents",
  description:
    "Read the book's Contents page: its settings (depth 0-3: 0 = chapters only, 1-3 add headings up to that level; pageNumbers), the resolved list in display order (key, kind page/heading/custom, level, title, renamed, hidden, entryId, target) and the stale override list (hidden, renamed, ordered keys or custom entries whose page or heading is gone). Keys are what cadabra_toc_update takes: a page is its id (ch-1), a heading is ch-1#2:the storm:0, a custom entry is custom:c-1. Fails with toc_no_contents_page when the book has none.",
  input: { path: PATH, language: LANGUAGE },
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
  run: ({ path, language }, ctx) => {
    const { root, manifest } = loadProject(ctx, path);
    const toc = describeToc(root, manifest, editionOf(manifest, language).language);
    return {
      summary: `Contents ${toc.contentsId}: ${toc.items.length} item(s), depth ${toc.settings.depth}${toc.stale.length ? `, ${toc.stale.length} stale override(s)` : ""}`,
      data: toc,
    };
  },
});

const ACTIONS = [
  "add_page",
  "set_depth",
  "set_page_numbers",
  "rename",
  "hide",
  "show",
  "move",
  "add_custom",
  "remove",
  "reset",
] as const;

const need = <T>(value: T | undefined, action: string, arg: string): T => {
  if (value === undefined) throw new ToolError("invalid_input", `${action} needs "${arg}"`);
  return value;
};

export const tocUpdate = defineTool({
  name: "cadabra_toc_update",
  title: "Update table of contents",
  description:
    'Change the Contents page. action: "add_page" (adds the Contents front-matter page, one per book: toc_page_exists; file first, then the manifest), "set_depth" (depth 0-3), "set_page_numbers" (pageNumbers), "rename" (key, title; an empty title for a page or heading removes the rename; in the edition given by language), "hide" / "show" (key), "move" (key, to: 0-based position in the displayed list, clamped), "add_custom" (title, after: key it follows, target?: key whose page number it shows), "remove" (key: clears the hidden/rename/order override of a key, or deletes a custom: entry; also works on stale keys listed by cadabra_toc_get), "reset" (clears every override, keeps depth and page numbers). The list is generated from the outline, so these are overrides on top of it; nothing is dropped from disk silently. Returns the resolved list like cadabra_toc_get. Unknown keys fail with toc_item_not_found.',
  input: {
    path: PATH,
    action: z.enum(ACTIONS).describe("What to do; the other arguments depend on it."),
    language: LANGUAGE,
    depth: z
      .number()
      .int()
      .min(0)
      .max(3)
      .optional()
      .describe("set_depth: 0 chapters only, 1-3 also list headings up to that level."),
    pageNumbers: z.boolean().optional().describe("set_page_numbers: show page numbers."),
    key: z
      .string()
      .min(1)
      .optional()
      .describe("rename, hide, show, move, remove: item key from cadabra_toc_get."),
    title: z.string().optional().describe("rename, add_custom: the text."),
    to: z.number().int().optional().describe("move: new 0-based position in the displayed list."),
    after: z.string().min(1).optional().describe("add_custom: key of the item it follows."),
    target: z
      .string()
      .min(1)
      .optional()
      .describe("add_custom: key whose page number the entry shows."),
  },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
  run: ({ path, action, language, depth, pageNumbers, key, title, to, after, target }, ctx) =>
    withLock(projectRoot(ctx, path), () => {
      const { root, manifest, hash } = loadProject(ctx, path);
      const lang = editionOf(manifest, language).language;
      let next: Manifest;
      let created: string | undefined;
      let createdFile: string | undefined;
      if (action === "add_page") {
        if (!canAddMatter(manifest, "contents"))
          throw new ToolError("toc_page_exists", "the book already has a Contents page");
        const source = sourceEdition(manifest.editions);
        const added = addFrontMatter(
          manifest,
          "contents",
          starterTitle("contents", source.language),
        );
        const file = entryFile(added.entry, source.language)!;
        if (readProjectFile(root, file))
          throw new ToolError(
            "io_error",
            `${file} already exists on disk but is not listed in the book; refusing to overwrite it`,
          );
        const doc = starterDoc("contents", {
          title: source.title,
          author: source.author,
          language: source.language,
          isbn: source.isbn,
          year: new Date().getFullYear(),
        });
        writeProjectFile(root, file, JSON.stringify(doc, null, 2));
        createdFile = file;
        next = added.manifest;
        created = added.entry.id;
      } else {
        const entry = contentsPage(manifest);
        const id = entry.id;
        const items = resolveToc(manifest, entry, lang, readOutlines(root, manifest, entry, lang));
        const stale = staleOverrides(entry, items).map((s) => s.key);
        const shown = new Set(items.map((i) => i.key));
        const known = (k: string, withStale: boolean): string => {
          if (shown.has(k) || (withStale && stale.includes(k))) return k;
          throw new ToolError(
            "toc_item_not_found",
            `no contents item "${k}"; keys come from cadabra_toc_get`,
            { key: k },
          );
        };
        switch (action) {
          case "set_depth":
            next = setTocDepth(manifest, id, need(depth, action, "depth") as TocDepth);
            break;
          case "set_page_numbers":
            next = setTocPageNumbers(manifest, id, need(pageNumbers, action, "pageNumbers"));
            break;
          case "rename": {
            const k = known(need(key, action, "key"), false);
            const text = need(title, action, "title");
            if (text.trim() === "" && k.startsWith("custom:"))
              throw new ToolError("invalid_input", "a custom contents entry needs a title");
            next = renameTocItem(manifest, id, k, lang, text);
            break;
          }
          case "hide":
            next = hideTocItem(manifest, id, known(need(key, action, "key"), false));
            break;
          case "show":
            next = showTocItem(manifest, id, known(need(key, action, "key"), true));
            break;
          case "move":
            next = moveTocItem(
              manifest,
              id,
              items,
              known(need(key, action, "key"), false),
              need(to, action, "to"),
            );
            break;
          case "add_custom": {
            const text = need(title, action, "title");
            if (text.trim() === "")
              throw new ToolError("invalid_input", "a custom contents entry needs a title");
            const added = addTocCustom(manifest, id, {
              language: lang,
              title: text,
              after: known(need(after, action, "after"), false),
              ...(target === undefined ? {} : { target: known(target, false) }),
            });
            next = added.manifest;
            created = added.key;
            break;
          }
          case "remove":
            next = removeTocOverride(manifest, id, known(need(key, action, "key"), true));
            break;
          default:
            next = resetToc(manifest, id);
        }
      }
      const changed = next !== manifest;
      let w: ReturnType<typeof saveManifest> | null = null;
      if (changed) {
        try {
          w = saveManifest(root, next, hash);
        } catch (e) {
          // The Contents file was written before the manifest: take it back, or a retry would refuse to overwrite the unlisted file.
          if (createdFile !== undefined) rmSync(join(root, createdFile), { force: true });
          throw e;
        }
      }
      const toc = describeToc(root, next, lang);
      return {
        summary: `${action}: Contents ${toc.contentsId} now lists ${toc.items.length} item(s)`,
        data: {
          ...toc,
          action,
          changed,
          ...(created === undefined ? {} : { created }),
          manifestHash: w?.hash ?? hash,
          conflictCopy: w?.conflictCopy ?? null,
        },
      };
    }),
});

export const tocTools: ToolDef[] = [tocGet, tocUpdate];
