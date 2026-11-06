import { randomUUID } from "node:crypto";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { addEdition, createManifest, danglingLinks, entryFile, isTranslated, parseManifest, readingOrder, serializeManifest, sourceEdition, sourceTitle, translationProgress } from "@cadabracraft/format";
import { MANIFEST, ProjectFsError, countWords, createProject, imageExt, looksLike, readAsset, readProjectFile, resolveInWorkspace, writeProjectFile } from "@cadabracraft/project-fs";
import { DEFAULT_TEMPLATE_ID, getTemplate, hasTemplate, listTemplates } from "@cadabracraft/templates";
import { isAssetPath, errMsg, TRIM_SIZE_IDS } from "@cadabracraft/shared";
import { emptyChapterDoc, imageSources, schemaProblem } from "../doc";
import { ToolError } from "../errors";
import { editionOf, loadProject, projectRoot, readChapterFile, saveManifest, sectionOf } from "../project";
import { type ToolDef, defineTool, withLock } from "../tooling";

export const PATH = z.string().min(1).describe("Project folder: relative to the workspace root, or an absolute path inside it.");

export const validLanguage = (l: string): boolean => {
  try {
    return Intl.getCanonicalLocales(l).length === 1;
  } catch {
    // Intl throws RangeError for a malformed tag.
    return false;
  }
};

const assetNames = (root: string): string[] => {
  const dir = join(root, "assets");
  return existsSync(dir) ? readdirSync(dir).filter((n) => imageExt(n)).sort().map((n) => `assets/${n}`) : [];
};

export const projectCreate = defineTool({
  name: "cadabra_project_create",
  title: "Create project",
  description: "Create a new CadabraCraft book project folder (manifest plus standard folders). Refuses if a project already exists there. The book starts with no chapters.",
  input: {
    path: PATH,
    title: z.string().min(1).describe("Book title."),
    author: z.string().min(1).describe("Author name."),
    language: z.string().min(2).optional().describe('BCP 47 language tag, default "en".'),
    template: z.string().optional().describe('Template id (see cadabra_list_templates), default "novel".'),
    trimSize: z.enum(TRIM_SIZE_IDS).optional().describe("Print page size in inches, stored in the manifest; default is the template's."),
    bodyFont: z.string().trim().min(1).max(100).optional().describe("Body font family name, stored in the manifest (cadabra.json `fonts.body`); default is the template's. The PDF export refuses the book when the font is not installed."),
    headingFont: z.string().trim().min(1).max(100).optional().describe("Heading font family name, stored in the manifest (`fonts.heading`); default is the template's."),
  },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
  run: ({ path, title, author, language, template, trimSize, bodyFont, headingFont }, ctx) => {
    if (language !== undefined && !validLanguage(language)) throw new ToolError("invalid_input", `"${language}" is not a valid BCP 47 language tag`);
    if (template !== undefined && !hasTemplate(template)) getTemplate(template); // throws template_unknown with the available ids
    const root = resolveInWorkspace(ctx.ws, path);
    const manifest = createManifest({ title, author, language, template: template ?? DEFAULT_TEMPLATE_ID, ...(trimSize ? { trimSize } : {}), ...(bodyFont || headingFont ? { fonts: { ...(bodyFont ? { body: bodyFont } : {}), ...(headingFont ? { heading: headingFont } : {}) } } : {}), identifier: `urn:uuid:${randomUUID()}` });
    createProject(root, serializeManifest(manifest));
    return { summary: `Created project "${title}" at ${root}`, data: { root, manifest } };
  },
});

export const projectInfo = defineTool({
  name: "cadabra_project_info",
  title: "Project info",
  description: "Read a project's manifest, its chapters in reading order with word counts, and the image files in assets/. With language, titles, files and word counts are those of that edition (a page with no text there yet has no file and 0 words). Each entry lists its translations with whether they are translated yet, and `editions` gives the progress per language.",
  input: { path: PATH, language: z.string().min(1).optional().describe("Edition to report (language code); default is the source edition.") },
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
  run: ({ path, language }, ctx) => {
    const { root, manifest, hash } = loadProject(ctx, path);
    const edition = editionOf(manifest, language);
    const lang = edition.language;
    const entries = sectionOf(manifest).map(({ entry, section }) => {
      const file = entryFile(entry, lang);
      const translations = Object.fromEntries(manifest.editions.map((e) => [e.language, { file: entryFile(entry, e.language) ?? null, translated: isTranslated(entry, e.language, manifest.editions) }]));
      const base = { id: entry.id, title: entry.titles[lang] ?? sourceTitle(entry, manifest.editions), file: file ?? null, section, translations };
      if (!file) return { ...base, words: 0 };
      try {
        const words = countWords(readChapterFile(root, file).doc);
        return { ...base, words };
      } catch (e) {
        const err = e instanceof ToolError ? e : null;
        return { ...base, words: 0, ...(err?.code === "chapter_missing" ? { missing: true } : { error: errMsg(e) }) };
      }
    });
    const chapters = manifest.chapters.length;
    const words = entries.reduce((n, e) => n + e.words, 0);
    return {
      summary: `"${edition.title}" by ${edition.author}${manifest.editions.length > 1 ? ` (${lang})` : ""}: ${chapters} chapter(s), ${words} words`,
      data: { root, manifest, manifestHash: hash, language: lang, entries, totals: { chapters, words }, editions: manifest.editions.map((e) => ({ language: e.language, title: e.title, ...translationProgress(manifest, e.language) })), assets: assetNames(root) },
    };
  },
});

export interface Issue {
  severity: "error" | "warning";
  code: string;
  where: string;
  message: string;
}

type AddIssue = (severity: Issue["severity"], code: string, where: string, message: string) => void;

/** "missing", "invalid" or null (fine) for an image the chapters use. */
function assetStatus(root: string, src: string): string | null {
  try {
    return looksLike(imageExt(src)!, readAsset(root, src)) ? null : "invalid";
  } catch (err) {
    return err instanceof ProjectFsError && err.code === "not_found" ? "missing" : "invalid";
  }
}

interface CheckCtx {
  root: string;
  checkedAssets: Map<string, string | null>;
  add: AddIssue;
}

function checkImage({ root, checkedAssets, add }: CheckCtx, id: string, file: string, src: string): void {
  if (!isAssetPath(src) || !imageExt(src)) {
    add("error", "asset_path_invalid", id, `${file}: image source "${src}" is not a project-relative assets/<image> path`);
    return;
  }
  if (!checkedAssets.has(src)) checkedAssets.set(src, assetStatus(root, src));
  const status = checkedAssets.get(src);
  if (status === "missing") add("error", "asset_missing", id, `${file}: image ${src} does not exist`);
  else if (status === "invalid") add("error", "asset_invalid", id, `${file}: image ${src} is not a valid ${imageExt(src)} image`);
}

function checkChapterFile(ctx: CheckCtx, id: string, file: string): void {
  const { root, add } = ctx;
  let doc: unknown;
  try {
    doc = readChapterFile(root, file).doc;
  } catch (err) {
    add("error", err instanceof ToolError ? err.code : "chapter_unreadable", id, errMsg(err));
    return;
  }
  const problem = schemaProblem(doc);
  if (problem) {
    add("error", "chapter_schema_invalid", id, `${file}: ${problem}`);
    return;
  }
  for (const src of imageSources(doc)) checkImage(ctx, id, file, src);
}

export const projectValidate = defineTool({
  name: "cadabra_project_validate",
  title: "Validate project",
  description: "Check a project: manifest, every chapter file (JSON parses and matches the real editor schema), that referenced images exist in assets/ and are valid images, and (as warnings) reference files that are missing and reference links to chapters that no longer exist. Reports issues instead of failing.",
  input: { path: PATH },
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
  run: ({ path }, ctx) => {
    const root = projectRoot(ctx, path);
    const issues: Issue[] = [];
    const add: AddIssue = (severity, code, where, message) => issues.push({ severity, code, where, message });
    let manifest;
    try {
      const raw = readProjectFile(root, MANIFEST);
      manifest = parseManifest(raw?.contents ?? "").manifest;
    } catch (e) {
      add("error", "manifest_invalid", "manifest", errMsg(e));
      return report(issues);
    }
    if (!hasTemplate(manifest.template)) add("error", "template_unknown", "manifest", `unknown template "${manifest.template}"`);
    const checkedAssets = new Map<string, string | null>();
    // Every page file of every edition (a translation that has no file yet is just untranslated, not an error).
    const files = readingOrder(manifest).flatMap((e) => Object.values(e.files).map((file) => ({ e, file })));
    for (const { e, file } of files) checkChapterFile({ root, checkedAssets, add }, e.id, file);
    for (const r of manifest.references)
      if (!existsSync(join(root, r.file))) add("warning", "reference_missing", r.id, `${r.file} does not exist`);
    for (const l of danglingLinks(manifest))
      add("warning", "reference_link_dangling", l.reference, `linked to ${l.chapter}, which is not in the book`);
    return report(issues);
  },
});

function report(issues: Issue[]) {
  const errors = issues.filter((i) => i.severity === "error").length;
  const warnings = issues.length - errors;
  return {
    summary: errors === 0 ? `Valid${warnings ? ` with ${warnings} warning(s)` : ""}` : `${errors} error(s), ${warnings} warning(s)`,
    data: { valid: errors === 0, errors, warnings, issues },
  };
}

export const listTemplatesTool = defineTool({
  name: "cadabra_list_templates",
  title: "List templates",
  description: "List the built-in book templates (id, name, description, default PDF trim size).",
  input: {},
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
  run: () => {
    const templates = listTemplates().map((t) => ({ id: t.id, name: t.name, description: t.description, defaultTrimSize: t.print.defaults.trimSize }));
    return { summary: `${templates.length} templates: ${templates.map((t) => t.id).join(", ")}`, data: { templates, default: DEFAULT_TEMPLATE_ID } };
  },
});

export const setTemplate = defineTool({
  name: "cadabra_set_template",
  title: "Set template",
  description: "Set the book's template (used by EPUB and PDF export). Only the manifest changes.",
  input: { path: PATH, template: z.string().min(1).describe("Template id from cadabra_list_templates.") },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
  run: ({ path, template }, ctx) => {
    getTemplate(template);
    const root = projectRoot(ctx, path);
    return withLock(root, () => {
      const { manifest, hash } = loadProject(ctx, path);
      if (manifest.template === template) return { summary: `Template already "${template}"`, data: { template, changed: false } };
      const w = saveManifest(root, { ...manifest, template }, hash);
      return { summary: `Template set to "${template}"`, data: { template, previous: manifest.template, changed: true, conflictCopy: w.conflictCopy } };
    });
  },
});

export const editionAdd = defineTool({
  name: "cadabra_edition_add",
  title: "Add edition",
  description: "Add a translation edition (a language) to the book. Every page gets a file in that language, marked untranslated until written with cadabra_chapter_write_json or _write_markdown (language). mode \"copy\" starts each page as a copy of the source text, \"empty\" as a heading and a blank paragraph. The edition starts with the source title and author and a new identifier. Any valid BCP 47 code is accepted (the app's language list is narrower). Refuses a language the book already has (language_exists).",
  input: {
    path: PATH,
    language: z.string().min(2).describe('BCP 47 language tag of the new edition, e.g. "fr".'),
    mode: z.enum(["copy", "empty"]).describe("copy: pages start as copies of the source text; empty: pages start blank."),
  },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
  run: ({ path, language, mode }, ctx) => {
    if (!validLanguage(language)) throw new ToolError("invalid_input", `"${language}" is not a valid BCP 47 language tag`);
    const root = projectRoot(ctx, path);
    return withLock(root, () => {
      const { manifest, hash } = loadProject(ctx, path);
      if (manifest.editions.some((e) => e.language === language)) throw new ToolError("language_exists", `the book already has a "${language}" edition`);
      const source = sourceEdition(manifest.editions);
      const { manifest: next, files } = addEdition(manifest, { language, title: source.title, author: source.author, identifier: `urn:uuid:${randomUUID()}`, isbn: null, cover: null }, mode);
      // Read everything first so a missing source file leaves the project untouched.
      const contents = files.map((f) => {
        if (readProjectFile(root, f.path)) throw new ToolError("io_error", `${f.path} already exists on disk but is not listed in the book; refusing to overwrite it`);
        return f.from === null ? JSON.stringify(emptyChapterDoc(f.title), null, 2) : readChapterFile(root, f.from).raw;
      });
      files.forEach((f, i) => writeProjectFile(root, f.path, contents[i]!));
      const w = saveManifest(root, next, hash);
      return { summary: `Added the "${language}" edition (${files.length} pages, ${mode})`, data: { language, mode, pages: files.length, files: files.map((f) => f.path), manifestHash: w.hash, conflictCopy: w.conflictCopy } };
    });
  },
});

export const projectTools: ToolDef[] = [projectCreate, projectInfo, projectValidate, listTemplatesTool, setTemplate, editionAdd];
