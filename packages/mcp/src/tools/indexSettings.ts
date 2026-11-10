// Settings of the generated index and glossary pages (manifest `index` and `glossary`). Reading never writes; a change is
// validated by the format package before cadabra.json is saved.
import { z } from "zod";
import {
  defaultGlossarySettings,
  defaultIndexSettings,
  validateGlossarySettings,
  validateIndexSettings,
  type Manifest,
} from "@cadabracraft/format";
import { errMsg, termKey } from "@cadabracraft/shared";
import { ToolError } from "../errors";
import { loadProject, projectRoot, saveManifest, type Loaded } from "../project";
import { type ToolDef, defineTool, withLock } from "../tooling";
import { PATH } from "./project";

/** Validates `next` (a settings object with the changes applied); a format error is the caller's bad input. */
function checked<T>(validate: (v: unknown) => T, next: unknown): T {
  try {
    return validate(next);
  } catch (e) {
    // The validators only throw FormatError: every one of them is a problem with what the caller sent.
    throw new ToolError("invalid_input", errMsg(e));
  }
}

/** The settings with `patch` applied; saved only when something was asked for and it differs from what is stored. */
function change<K extends "index" | "glossary">(
  loaded: Loaded,
  key: K,
  current: (m: Manifest) => NonNullable<Manifest[K]>,
  patchOf: (current: NonNullable<Manifest[K]>) => Record<string, unknown>,
  validate: (v: unknown) => NonNullable<Manifest[K]>,
) {
  const { root, manifest, hash } = loaded;
  const was = current(manifest);
  const patch = patchOf(was);
  const next = checked(validate, { ...was, ...patch });
  const asked = Object.keys(patch).length > 0;
  const changed = asked && JSON.stringify(next) !== JSON.stringify(manifest[key]);
  const saved = changed ? saveManifest(root, { ...manifest, [key]: next }, hash) : null;
  return {
    settings: next,
    changed,
    manifestHash: saved?.hash ?? hash,
    conflictCopy: saved?.conflictCopy ?? null,
  };
}

/** The keys of `args` that were given. */
const given = (args: Record<string, unknown>): Record<string, unknown> =>
  Object.fromEntries(Object.entries(args).filter(([, v]) => v !== undefined));

/** The new hidden list when `hidden` (replace), `hide` (add) or `unhide` (remove) was given; nothing otherwise. */
function hiddenPatch(
  current: string[],
  hidden: string[] | undefined,
  hide: string[] | undefined,
  unhide: string[] | undefined,
): { hidden?: string[] } {
  if (hidden === undefined && hide === undefined && unhide === undefined) return {};
  const gone = new Set((unhide ?? []).map(termKey));
  const list = (hidden ?? current).filter((t) => !gone.has(termKey(t)));
  for (const t of hide ?? []) if (!list.some((x) => termKey(x) === termKey(t))) list.push(t);
  return { hidden: list };
}

const HEADING = (page: string) =>
  z.string().optional().describe(`The ${page} page's title (one line, up to 100 characters).`);

export const indexSettings = defineTool({
  name: "cadabra_index_settings",
  title: "Index settings",
  description:
    'Read or change the back-of-book index settings in cadabra.json (no arguments besides path just reads them; a book with no index shows the defaults). enabled: write the index page at the end of the book in every export (default false); heading (default "Index"); columns 1 or 2 (print only); ranges (12-15 instead of 12, 13, 14, 15; print only); letterHeadings (A, B, C above each group); hideSingles (leave out terms that appear once with no subentries or cross-references); hidden: replace the list of terms the author leaves out, or hide / unhide add and remove single terms. Invalid values fail with invalid_input and nothing is written. Returns the settings, changed, manifestHash and conflictCopy.',
  input: {
    path: PATH,
    enabled: z.boolean().optional().describe("Write the index page in the exports."),
    heading: HEADING("index"),
    columns: z
      .union([z.literal(1), z.literal(2)])
      .optional()
      .describe("Columns on the printed page."),
    ranges: z.boolean().optional().describe("Print page ranges (12-15)."),
    letterHeadings: z.boolean().optional().describe("Letter headings above each group."),
    hideSingles: z
      .boolean()
      .optional()
      .describe("Leave out terms that appear once and have no subentries or cross-references."),
    hidden: z.array(z.string()).optional().describe("Replace the list of hidden terms."),
    hide: z.array(z.string()).optional().describe("Terms to add to the hidden list."),
    unhide: z
      .array(z.string())
      .optional()
      .describe("Terms to take off the hidden list (compared without case or accents)."),
  },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
  run: ({ path, hidden, hide, unhide, ...rest }, ctx) =>
    withLock(projectRoot(ctx, path), () => {
      const r = change<"index">(
        loadProject(ctx, path),
        "index",
        (m) => m.index ?? defaultIndexSettings(),
        (cur) => ({ ...given(rest), ...hiddenPatch(cur.hidden, hidden, hide, unhide) }),
        (v) => validateIndexSettings(v),
      );
      return {
        summary: `Index ${r.settings.enabled ? "on" : "off"}${r.changed ? " (settings saved)" : ""}`,
        data: r,
      };
    }),
});

export const glossarySettings = defineTool({
  name: "cadabra_glossary_settings",
  title: "Glossary settings",
  description:
    'Read or change the glossary page settings in cadabra.json (no arguments besides path just reads them, with the entries; a book with no glossary shows the defaults). enabled: write the glossary page after the index in every export (default false; entries with no definition are always left out); heading (default "Glossary"); order "alpha" (by term, for the book\'s language) or "added" (the order of the entries); inIndex: also list each used term in the index; markFirstUse: the EPUB links the first use of a term in each chapter to its entry; showUndefined: list entries with no definition in the app. Entries are changed with cadabra_glossary_add / _update / _remove. Invalid values fail with invalid_input and nothing is written.',
  input: {
    path: PATH,
    enabled: z.boolean().optional().describe("Write the glossary page in the exports."),
    heading: HEADING("glossary"),
    order: z
      .enum(["alpha", "added"])
      .optional()
      .describe("alpha sorts by term, added keeps the entries' order."),
    inIndex: z.boolean().optional().describe("Also list each used glossary term in the index."),
    markFirstUse: z
      .boolean()
      .optional()
      .describe("EPUB: link the first use of a term in each chapter to its entry."),
    showUndefined: z.boolean().optional().describe("List entries with no definition in the app."),
  },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
  run: ({ path, ...rest }, ctx) =>
    withLock(projectRoot(ctx, path), () => {
      const r = change<"glossary">(
        loadProject(ctx, path),
        "glossary",
        (m) => m.glossary ?? defaultGlossarySettings(),
        () => given(rest),
        (v) => validateGlossarySettings(v),
      );
      return {
        summary: `Glossary ${r.settings.enabled ? "on" : "off"}, ${r.settings.entries.length} entr${r.settings.entries.length === 1 ? "y" : "ies"}${r.changed ? " (settings saved)" : ""}`,
        data: r,
      };
    }),
});

export const settingsTools: ToolDef[] = [indexSettings, glossarySettings];
