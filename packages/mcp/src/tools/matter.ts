// Back matter tools: add a page (an author's note, an index, a glossary...) at the end of the back matter.
import { rmSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import {
  addBackMatter,
  canAddMatter,
  entryFile,
  sourceEdition,
  starterDoc,
  starterTitle,
} from "@cadabracraft/format";
import { readProjectFile, writeProjectFile } from "@cadabracraft/project-fs";
import { BACK_MATTER_KINDS } from "@cadabracraft/shared";
import { ToolError } from "../errors";
import { loadProject, projectRoot, saveManifest } from "../project";
import { type ToolDef, defineTool, withLock } from "../tooling";
import { PATH } from "./project";

export const matterAdd = defineTool({
  name: "cadabra_matter_add",
  title: "Add back matter page",
  description:
    'Add a back matter page at the end of the book: kind is one of the back matter kinds. "index" and "glossary" are generated pages (one of each per book): they list the index entries or glossary terms where the page sits, and adding one turns that list on. The page file is written first, then the manifest.',
  input: {
    path: PATH,
    kind: z.enum(BACK_MATTER_KINDS).describe("The kind of page."),
    title: z.string().min(1).optional().describe("Page title; default is the kind's usual title."),
  },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
  run: ({ path, kind, title }, ctx) =>
    withLock(projectRoot(ctx, path), () => {
      const { root, manifest, hash } = loadProject(ctx, path);
      if (!canAddMatter(manifest, kind))
        throw new ToolError("matter_page_exists", `the book already has a ${kind} page`);
      const source = sourceEdition(manifest.editions);
      const added = addBackMatter(manifest, kind, title ?? starterTitle(kind, source.language));
      const file = entryFile(added.entry, source.language)!;
      if (readProjectFile(root, file))
        throw new ToolError(
          "io_error",
          `${file} already exists on disk but is not listed in the book; refusing to overwrite it`,
        );
      const doc = starterDoc(kind, {
        title: source.title,
        author: source.author,
        language: source.language,
        isbn: source.isbn,
        year: new Date().getFullYear(),
      });
      writeProjectFile(root, file, JSON.stringify(doc, null, 2));
      try {
        const w = saveManifest(root, added.manifest, hash);
        return {
          summary: `Added ${kind} page ${added.entry.id} "${added.entry.titles[source.language]}" (${file})`,
          data: { id: added.entry.id, kind, file, manifestHash: w.hash, conflictCopy: w.conflictCopy },
        };
      } catch (e) {
        // The file was written before the manifest: take it back, or a retry would refuse to overwrite it.
        rmSync(join(root, file), { force: true });
        throw e;
      }
    }),
});

export const matterTools: ToolDef[] = [matterAdd];
