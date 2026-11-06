import { isValidEntryId } from "@cadabracraft/shared";
import { FormatError } from "./errors";
import type { FileReference, LinkReference, Manifest, NoteReference, Reference } from "./manifest";

/**
 * Reference files (formatVersion 5): research material kept beside the book. Pure manifest edits and checks;
 * nothing here touches disk. The files live in `references/`, flat, with the same naming rules as assets.
 */

const FILE = /^references\/[A-Za-z0-9_-]+(\.[a-z0-9]+)?$/;

const text = (v: unknown, name: string, allowEmpty = false): string => {
  if (typeof v !== "string" || (!allowEmpty && v === ""))
    throw new FormatError(
      `manifest: "${name}" must be a ${allowEmpty ? "string" : "non-empty string"}`,
    );
  return v;
};

const strings = (v: unknown, name: string): string[] => {
  if (!Array.isArray(v)) throw new FormatError(`manifest: "${name}" must be a list`);
  return v.map((s, i) => text(s, `${name}[${i}]`));
};

/** Migration step: formatVersion 4 -> 5. Adds an empty list; nothing else changes and no file moves. */
export const migrateV4ToV5 = (raw: Record<string, unknown>): Record<string, unknown> => ({
  ...raw,
  references: [],
});

/** Migration step: formatVersion 11 -> 12. Every reference so far is a file, so each gets `kind: "file"`. */
export const migrateV11ToV12 = (raw: Record<string, unknown>): Record<string, unknown> => ({
  ...raw,
  references: Array.isArray(raw.references)
    ? raw.references.map((r) => ({ kind: "file", ...(r as object) }))
    : raw.references,
});

/** Longest text note, in characters. */
export const MAX_NOTE_CHARS = 20_000;
/** Longest link address, in characters. */
export const MAX_URL_CHARS = 2_048;

/**
 * The address as the web would read it, or null: only http and https, with a host, no spaces or control characters, at most
 * `MAX_URL_CHARS` long. Surrounding spaces are trimmed first.
 */
export function normalizeWebUrl(input: string): string | null {
  const s = input.trim();
  // eslint-disable-next-line no-control-regex
  if (s === "" || s.length > MAX_URL_CHARS || /[\s\u0000-\u001f\u007f]/.test(s)) return null;
  try {
    const u = new URL(s);
    return (u.protocol === "http:" || u.protocol === "https:") && u.hostname !== "" ? u.href : null;
  } catch {
    return null;
  }
}

/** Validates the `references` list. Chapter ids are not checked here: see `danglingLinks`. */
export function validateReferences(v: unknown): Reference[] {
  if (!Array.isArray(v)) throw new FormatError(`manifest: "references" must be an array`);
  const ids = new Set<string>();
  const files = new Set<string>();
  return v.map((r, i) => {
    const o = (r ?? {}) as Record<string, unknown>;
    const name = `references[${i}]`;
    const id = text(o.id, `${name}.id`);
    if (!isValidEntryId(id))
      throw new FormatError(
        `manifest: "${name}.id" must start with a letter and use only letters, digits, "-" and "_" (got ${JSON.stringify(id)})`,
      );
    if (ids.has(id)) throw new FormatError(`manifest: duplicate reference id "${id}"`);
    ids.add(id);
    const kind = o.kind;
    if (kind !== "file" && kind !== "link" && kind !== "note")
      throw new FormatError(`manifest: "${name}.kind" must be "file", "link" or "note"`);
    const only = (field: "file" | "url" | "text") => {
      for (const other of ["file", "url", "text"] as const)
        if (other !== field && o[other] !== undefined)
          throw new FormatError(`manifest: "${name}.${other}" is not allowed on a ${kind}`);
    };
    let body:
      | { kind: "file"; file: string }
      | { kind: "link"; url: string }
      | { kind: "note"; text: string };
    if (kind === "file") {
      only("file");
      const file = text(o.file, `${name}.file`);
      if (!FILE.test(file))
        throw new FormatError(
          `manifest: "${name}.file" must be references/<name> with only letters, digits, "-" and "_", got ${JSON.stringify(file)}`,
        );
      if (files.has(file)) throw new FormatError(`manifest: duplicate reference file "${file}"`);
      files.add(file);
      body = { kind, file };
    } else if (kind === "link") {
      only("url");
      const url = text(o.url, `${name}.url`);
      if (normalizeWebUrl(url) !== url)
        throw new FormatError(`manifest: "${name}.url" must be an http or https address`);
      body = { kind, url };
    } else {
      only("text");
      const t = text(o.text, `${name}.text`);
      if (t.length > MAX_NOTE_CHARS)
        throw new FormatError(
          `manifest: "${name}.text" is longer than ${MAX_NOTE_CHARS} characters`,
        );
      body = { kind, text: t };
    }
    const tags = strings(o.tags, `${name}.tags`);
    if (new Set(tags).size !== tags.length)
      throw new FormatError(`manifest: "${name}.tags" has a duplicate tag`);
    const addedAt = text(o.addedAt, `${name}.addedAt`);
    if (Number.isNaN(Date.parse(addedAt)))
      throw new FormatError(`manifest: "${name}.addedAt" must be a date and time`);
    return {
      id,
      ...body,
      title: text(o.title, `${name}.title`),
      note: text(o.note, `${name}.note`, true),
      tags,
      chapters: strings(o.chapters, `${name}.chapters`),
      addedAt,
    };
  });
}

const entryIds = (m: Manifest): Set<string> =>
  new Set([...m.frontMatter, ...m.chapters, ...m.backMatter].map((e) => e.id));

/** Links that name a chapter or matter page the book no longer has, as `refId -> chapterId` pairs. */
export function danglingLinks(m: Manifest): { reference: string; chapter: string }[] {
  const ids = entryIds(m);
  return m.references.flatMap((r) =>
    r.chapters.filter((c) => !ids.has(c)).map((chapter) => ({ reference: r.id, chapter })),
  );
}

/** The next free `ref-N` id. */
export function nextReferenceId(m: Manifest): string {
  const used = new Set(m.references.map((r) => r.id));
  for (let n = m.references.length + 1; ; n++) if (!used.has(`ref-${n}`)) return `ref-${n}`;
}

type AddInit = { title: string; addedAt: string };

const append = <R extends Reference>(
  m: Manifest,
  body: Omit<R, "id" | "note" | "tags" | "chapters">,
): { manifest: Manifest; reference: R } => {
  const reference = {
    id: nextReferenceId(m),
    ...body,
    note: "",
    tags: [],
    chapters: [],
  } as unknown as R;
  return { manifest: { ...m, references: [...m.references, reference] }, reference };
};

/** Adds an imported file to the end of the list under a fresh id. `file` is the relative `references/<name>` path. */
export const addReference = (
  m: Manifest,
  init: AddInit & { file: string },
): { manifest: Manifest; reference: FileReference } =>
  append<FileReference>(m, {
    kind: "file",
    file: init.file,
    title: init.title,
    addedAt: init.addedAt,
  });

/** Adds a web link. `url` must already be what `normalizeWebUrl` returns. */
export function addLinkReference(
  m: Manifest,
  init: AddInit & { url: string },
): { manifest: Manifest; reference: LinkReference } {
  if (normalizeWebUrl(init.url) !== init.url)
    throw new FormatError(`reference: "${init.url}" is not an http or https address`);
  return append<LinkReference>(m, {
    kind: "link",
    url: init.url,
    title: init.title,
    addedAt: init.addedAt,
  });
}

/** Adds a text note. */
export function addNoteReference(
  m: Manifest,
  init: AddInit & { text: string },
): { manifest: Manifest; reference: NoteReference } {
  if (init.text.length > MAX_NOTE_CHARS)
    throw new FormatError(`reference: a note is at most ${MAX_NOTE_CHARS} characters`);
  return append<NoteReference>(m, {
    kind: "note",
    text: init.text,
    title: init.title,
    addedAt: init.addedAt,
  });
}

const find = (m: Manifest, id: string): Reference => {
  const r = m.references.find((x) => x.id === id);
  if (!r) throw new Error(`no reference ${id}`);
  return r;
};

/** Changes title, note, tags or linked chapters. Tags and links are de-duplicated and tags are trimmed. */
export function updateReference(
  m: Manifest,
  id: string,
  patch: Partial<Pick<Reference, "title" | "note" | "tags" | "chapters">> & {
    url?: string;
    text?: string;
  },
): Manifest {
  const current = find(m, id);
  if (
    patch.url !== undefined &&
    (current.kind !== "link" || normalizeWebUrl(patch.url) !== patch.url)
  )
    throw new FormatError(`reference: ${id} cannot take the address "${patch.url}"`);
  if (patch.text !== undefined && (current.kind !== "note" || patch.text.length > MAX_NOTE_CHARS))
    throw new FormatError(`reference: ${id} cannot take that text`);
  const clean = (list: string[]) => [...new Set(list.map((s) => s.trim()).filter(Boolean))];
  return {
    ...m,
    references: m.references.map((r) =>
      r.id === id
        ? ({
            ...r,
            ...patch,
            ...(patch.tags ? { tags: clean(patch.tags) } : {}),
            ...(patch.chapters ? { chapters: [...new Set(patch.chapters)] } : {}),
          } as Reference)
        : r,
    ),
  };
}

export function removeReference(
  m: Manifest,
  id: string,
): { manifest: Manifest; removed: Reference } {
  const removed = find(m, id);
  return { manifest: { ...m, references: m.references.filter((r) => r.id !== id) }, removed };
}

/** The references linked to a chapter or matter page, in list order. */
export const referencesFor = (m: Manifest, entryId: string): Reference[] =>
  m.references.filter((r) => r.chapters.includes(entryId));

/** Drops the links to a removed chapter or matter page. Returns `m` itself when nothing linked to it. */
export function unlinkEntry(m: Manifest, entryId: string): Manifest {
  if (!m.references.some((r) => r.chapters.includes(entryId))) return m;
  return {
    ...m,
    references: m.references.map((r) =>
      r.chapters.includes(entryId)
        ? { ...r, chapters: r.chapters.filter((c) => c !== entryId) }
        : r,
    ),
  };
}

/** The `reference -> chapter` links an entry has, to put back if its removal is undone. */
export const linksOf = (m: Manifest, entryId: string): { reference: string; chapter: string }[] =>
  referencesFor(m, entryId).map((r) => ({ reference: r.id, chapter: entryId }));

/** Puts links back (an undone removal). A reference that was removed since is skipped; links already there are not doubled. */
export function relink(m: Manifest, links: { reference: string; chapter: string }[]): Manifest {
  return {
    ...m,
    references: m.references.map((r) => {
      const add = links.filter((l) => l.reference === r.id && !r.chapters.includes(l.chapter));
      return add.length ? { ...r, chapters: [...r.chapters, ...add.map((l) => l.chapter)] } : r;
    }),
  };
}

/** Puts a reference at position `to` of the list (clamped to the list); the others keep their order. Returns `m` itself when nothing moves. */
export function moveReference(m: Manifest, id: string, to: number): Manifest {
  const from = m.references.findIndex((r) => r.id === id);
  if (from < 0) throw new Error(`no reference ${id}`);
  const target = Math.min(m.references.length - 1, Math.max(0, to));
  if (target === from) return m;
  const list = [...m.references];
  const [r] = list.splice(from, 1);
  list.splice(target, 0, r!);
  return { ...m, references: list };
}
