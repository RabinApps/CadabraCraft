// Reference library tools: list, add (copy a workspace file into references/) and update the manifest entries.
// The import rules live in @cadabracraft/project-fs (importReference), the pure manifest edits in @cadabracraft/format.
import { lstatSync } from "node:fs";
import { z } from "zod";
import {
  addLinkReference,
  addNoteReference,
  addReference,
  MAX_NOTE_CHARS,
  normalizeWebUrl,
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

/**
 * A reference as the tools report it. `type` is file, link or note; `kind` is the media kind of a file (image, video, audio,
 * pdf, text, other) and repeats the type for a link and a note. `chapters` carries each linked page's title (null when the
 * book no longer has that id).
 */
const describeReference = (root: string, m: Manifest, r: Reference) => ({
  id: r.id,
  type: r.kind,
  title: r.title,
  ...(r.kind === "file"
    ? {
        file: r.file,
        // `references/<name>` has one dot at most and a lower-case extension (format rules), so the text after the last dot is the extension, or the whole name when there is none (then `other`).
        kind: referenceKind(r.file.includes(".") ? r.file.slice(r.file.lastIndexOf(".") + 1) : ""),
        exists: fileExists(root, r.file),
      }
    : r.kind === "link"
      ? { kind: "link", url: r.url }
      : { kind: "note", text: r.text }),
  note: r.note,
  tags: r.tags,
  chapters: r.chapters.map((id) => {
    const e = [...m.frontMatter, ...m.chapters, ...m.backMatter].find((x) => x.id === id);
    return { id, title: e ? sourceTitle(e, m.editions) : null };
  }),
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
    "List the book's references (research kept beside the book): id, type (file, link or note), title, note, tags and linked chapters (id and title). A file has its path, kind (image, video, audio, pdf, text, other) and whether it exists on disk; a link has its url; a note has its text.",
  input: { path: PATH },
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
  run: ({ path }, ctx) => {
    const { root, manifest } = loadProject(ctx, path);
    const references = manifest.references.map((r) => describeReference(root, manifest, r));
    const missing = references.filter((r) => "exists" in r && !r.exists).length;
    return {
      summary: `${references.length} reference(s)${missing ? `, ${missing} with a missing file` : ""}`,
      data: { references },
    };
  },
});

const hostOf = (url: string): string => new URL(url).hostname;
const firstLine = (text: string): string => text.trim().split(/\r?\n/, 1)[0]!.slice(0, 80);

/** Adds a link (url) or a note (text) to the manifest; there is no file to copy. */
function addLinkOrNote(
  ctx: Parameters<typeof loadProject>[0],
  path: string,
  input: { url?: string; text?: string; title?: string },
) {
  return withLock(projectRoot(ctx, path), () => {
    const { root, manifest, hash } = loadProject(ctx, path);
    const addedAt = new Date().toISOString();
    let added;
    if (input.url !== undefined) {
      const url = normalizeWebUrl(input.url);
      if (url === null)
        throw new ToolError("invalid_input", `"${input.url}" is not an http or https address`);
      added = addLinkReference(manifest, { url, title: input.title ?? hostOf(url), addedAt });
    } else {
      const text = input.text!;
      if (text.length > MAX_NOTE_CHARS)
        throw new ToolError("invalid_input", `a note is at most ${MAX_NOTE_CHARS} characters`);
      added = addNoteReference(manifest, {
        text,
        title: input.title ?? (firstLine(text) || "Note"),
        addedAt,
      });
    }
    const w = saveManifest(root, added.manifest, hash);
    return {
      summary: `Added ${added.reference.id} "${added.reference.title}" (${added.reference.kind})`,
      data: {
        reference: describeReference(root, added.manifest, added.reference),
        reused: false,
        conflictCopy: w.conflictCopy,
      },
    };
  });
}

export const referenceAdd = defineTool({
  name: "cadabra_reference_add",
  title: "Add reference",
  description:
    "Add a reference: give exactly one of source (a file), url (a web link) or text (a note). A link must be an http or https address; nothing is fetched. A note is up to 20000 characters. For a file: copy a file from the workspace into the book's references/ folder and list it as a reference. Names are reduced to A-Z a-z 0-9 _ - (a -2 suffix on a clash); identical content already in references/ returns the existing entry (reused: true). Size caps: video 500 MB, audio and PDF 200 MB, image and other 100 MB, text 5 MB. Programs, scripts and web pages (exe, sh, js, html...) are refused, and images, PDFs, audio, video and text are checked by their content. The source is never modified.",
  input: {
    path: PATH,
    source: z
      .string()
      .min(1)
      .optional()
      .describe("File to copy, relative to the workspace root or an absolute path inside it."),
    url: z.string().min(1).optional().describe("A web address (http or https) to keep as a link."),
    text: z.string().min(1).optional().describe("Text to keep as a note."),
    title: z
      .string()
      .trim()
      .min(1)
      .optional()
      .describe(
        "Title shown in the library; defaults to the file name without its extension, the address's host for a link, or the note's first line.",
      ),
  },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
  run: ({ path, source, url, text, title }, ctx) => {
    if ([source, url, text].filter((v) => v !== undefined).length !== 1)
      throw new ToolError("invalid_input", "give exactly one of source, url or text");
    if (url !== undefined || text !== undefined) return addLinkOrNote(ctx, path, { url, text, title });
    const sourcePath = resolveInWorkspace(ctx.ws, source!);
    return withLock(projectRoot(ctx, path), () => {
      const { root, manifest, hash } = loadProject(ctx, path);
      // The file is copied first, then the manifest is saved, so the list never names a file that is not there.
      const imported = importReference(root, sourcePath);
      const existing = manifest.references.find((r) => r.kind === "file" && r.file === imported.file);
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
    "Change a reference's title, note, tags or linked chapters (ids of chapters, front or back matter pages); for a link also its url, for a note also its text. Only the fields given change; tags and chapters replace the whole list. A file is not touched.",
  input: {
    path: PATH,
    referenceId: REFERENCE_ID,
    title: z.string().trim().min(1).optional().describe("New title."),
    note: z.string().optional().describe("New note (may be empty)."),
    url: z.string().min(1).optional().describe("New address (links only; http or https)."),
    text: z.string().optional().describe("New text (notes only)."),
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
  run: ({ path, referenceId, title, note, url, text, tags, chapters }, ctx) =>
    withLock(projectRoot(ctx, path), () => {
      const { root, manifest, hash } = loadProject(ctx, path);
      const current = manifest.references.find((r) => r.id === referenceId);
      if (!current)
        throw new ToolError(
          "reference_not_found",
          `no reference with id "${referenceId}"; see cadabra_reference_list`,
        );
      if (url !== undefined && (current.kind !== "link" || normalizeWebUrl(url) !== url))
        throw new ToolError(
          "invalid_input",
          current.kind === "link"
            ? `"${url}" is not an http or https address in its normal form (try ${normalizeWebUrl(url) ?? "a valid one"})`
            : `${referenceId} is not a link`,
        );
      if (text !== undefined && (current.kind !== "note" || text.length > MAX_NOTE_CHARS))
        throw new ToolError("invalid_input", `${referenceId} is not a note, or the text is too long`);
      for (const id of chapters ?? []) findEntry(manifest, id);
      const next = updateReference(manifest, referenceId, {
        ...(title !== undefined ? { title } : {}),
        ...(note !== undefined ? { note } : {}),
        ...(url !== undefined ? { url } : {}),
        ...(text !== undefined ? { text } : {}),
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
