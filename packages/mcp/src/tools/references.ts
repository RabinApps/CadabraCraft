// Reference library tools: list, add (copy a workspace file into references/) and update the manifest entries.
// The import rules live in @cadabracraft/project-fs (importReference), the pure manifest edits in @cadabracraft/format.
import { lstatSync } from "node:fs";
import { z } from "zod";
import {
  addReference,
  sourceTitle,
  updateReference,
  type Manifest,
  type Reference,
} from "@cadabracraft/format";
import {
  importReference,
  referenceKind,
  resolveInWorkspace,
  resolveSafe,
} from "@cadabracraft/project-fs";
import { ToolError } from "../errors";
import { findEntry, loadProject, projectRoot, saveManifest } from "../project";
import { type ToolDef, defineTool, withLock } from "../tooling";
import { PATH } from "./project";

const fileExists = (root: string, rel: string): boolean => {
  try {
    return lstatSync(resolveSafe(root, rel)).isFile();
  } catch {
    return false;
  }
};

/** A reference as the tools report it; `chapters` carries each linked page's title (null when the book no longer has that id). */
/** `references/<name>` has one dot at most and a lower-case extension (format rules), so the text after the last dot is the extension, or the whole name when there is none (then `other`). */
const describeReference = (root: string, m: Manifest, r: Reference) => ({
  id: r.id,
  title: r.title,
  file: r.file,
  kind: referenceKind(r.file.includes(".") ? r.file.slice(r.file.lastIndexOf(".") + 1) : ""),
  note: r.note,
  tags: r.tags,
  chapters: r.chapters.map((id) => {
    const e = [...m.frontMatter, ...m.chapters, ...m.backMatter].find((x) => x.id === id);
    return { id, title: e ? sourceTitle(e, m.editions) : null };
  }),
  exists: fileExists(root, r.file),
  addedAt: r.addedAt,
});

const REFERENCE_ID = z
  .string()
  .min(1)
  .describe("Reference id from cadabra_reference_list (e.g. ref-1).");

export const referenceList = defineTool({
  name: "cadabra_reference_list",
  title: "List references",
  description:
    "List the book's reference files (research material kept in references/): id, title, file, kind (image, video, audio, pdf, text, other), note, tags, linked chapters (id and title) and whether the file exists on disk.",
  input: { path: PATH },
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
  run: ({ path }, ctx) => {
    const { root, manifest } = loadProject(ctx, path);
    const references = manifest.references.map((r) => describeReference(root, manifest, r));
    const missing = references.filter((r) => !r.exists).length;
    return {
      summary: `${references.length} reference(s)${missing ? `, ${missing} with a missing file` : ""}`,
      data: { references },
    };
  },
});

export const referenceAdd = defineTool({
  name: "cadabra_reference_add",
  title: "Add reference",
  description:
    "Copy a file from the workspace into the book's references/ folder and list it as a reference. Names are reduced to A-Z a-z 0-9 _ - (a -2 suffix on a clash); identical content already in references/ returns the existing entry (reused: true). Size caps: video 500 MB, audio and PDF 200 MB, image and other 100 MB, text 5 MB. Programs, scripts and web pages (exe, sh, js, html...) are refused, and images, PDFs, audio, video and text are checked by their content. The source is never modified.",
  input: {
    path: PATH,
    source: z
      .string()
      .min(1)
      .describe("File to copy, relative to the workspace root or an absolute path inside it."),
    title: z
      .string()
      .trim()
      .min(1)
      .optional()
      .describe("Title shown in the library; defaults to the file name without its extension."),
  },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
  run: ({ path, source, title }, ctx) => {
    const sourcePath = resolveInWorkspace(ctx.ws, source);
    return withLock(projectRoot(ctx, path), () => {
      const { root, manifest, hash } = loadProject(ctx, path);
      // The file is copied first, then the manifest is saved, so the list never names a file that is not there.
      const imported = importReference(root, sourcePath);
      const existing = manifest.references.find((r) => r.file === imported.file);
      if (existing) {
        const patched =
          title && title !== existing.title
            ? updateReference(manifest, existing.id, { title })
            : manifest;
        const conflictCopy =
          patched === manifest ? null : saveManifest(root, patched, hash).conflictCopy;
        const reference = patched.references.find((r) => r.id === existing.id)!;
        return {
          summary: `${imported.file} is already ${reference.id} "${reference.title}"`,
          data: {
            reference: describeReference(root, patched, reference),
            reused: true,
            size: imported.size,
            conflictCopy,
          },
        };
      }
      const added = addReference(manifest, {
        file: imported.file,
        title: title ?? imported.title,
        addedAt: new Date().toISOString(),
      });
      const w = saveManifest(root, added.manifest, hash);
      return {
        summary: `Added ${added.reference.id} "${added.reference.title}" (${imported.file}, ${imported.kind}${imported.reused ? ", file already in references/" : ""})`,
        data: {
          reference: describeReference(root, added.manifest, added.reference),
          reused: false,
          fileReused: imported.reused,
          size: imported.size,
          conflictCopy: w.conflictCopy,
        },
      };
    });
  },
});

export const referenceUpdate = defineTool({
  name: "cadabra_reference_update",
  title: "Update reference",
  description:
    "Change a reference's title, note, tags or linked chapters (ids of chapters, front or back matter pages). Only the fields given change; tags and chapters replace the whole list. The file is not touched.",
  input: {
    path: PATH,
    referenceId: REFERENCE_ID,
    title: z.string().trim().min(1).optional().describe("New title."),
    note: z.string().optional().describe("New note (may be empty)."),
    tags: z
      .array(z.string())
      .optional()
      .describe("Replaces the tags (trimmed, de-duplicated, empty ones dropped)."),
    chapters: z
      .array(z.string().min(1))
      .optional()
      .describe("Replaces the linked chapter ids (from cadabra_project_info)."),
  },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
  run: ({ path, referenceId, title, note, tags, chapters }, ctx) =>
    withLock(projectRoot(ctx, path), () => {
      const { root, manifest, hash } = loadProject(ctx, path);
      if (!manifest.references.some((r) => r.id === referenceId))
        throw new ToolError(
          "reference_not_found",
          `no reference with id "${referenceId}"; see cadabra_reference_list`,
        );
      for (const id of chapters ?? []) findEntry(manifest, id);
      const next = updateReference(manifest, referenceId, {
        ...(title !== undefined ? { title } : {}),
        ...(note !== undefined ? { note } : {}),
        ...(tags ? { tags } : {}),
        ...(chapters ? { chapters } : {}),
      });
      const w = saveManifest(root, next, hash);
      const reference = next.references.find((r) => r.id === referenceId)!;
      return {
        summary: `Updated ${referenceId} "${reference.title}"`,
        data: { reference: describeReference(root, next, reference), conflictCopy: w.conflictCopy },
      };
    }),
});

export const referenceTools: ToolDef[] = [referenceList, referenceAdd, referenceUpdate];
