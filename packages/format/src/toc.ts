/*
 * Table of contents (formatVersion 7). A book's "Contents" page is an ordinary front-matter page (`kind: "contents"`) whose list is
 * generated from the outline. The manifest only stores `toc` (see `TocSettings`): depth, page-number switch and the author's
 * overrides layered on top of the live list (hide, rename, reorder, custom entries). Nothing here reads files or the clock.
 *
 * Item keys (strings, stable across edits elsewhere in a chapter):
 *   page     = the entry id                         "ch-1"
 *   heading  = `entryId#level:normalizedText:nth`    "ch-1#2:the storm:0" (nth = occurrence among identical headings, from 0)
 *   custom   = `custom:<id>`                         "custom:c-1"
 *   normalizedText = NFC, whitespace collapsed, trimmed, lower-cased.
 *
 * Types
 *   TocItem { key; kind: "page"|"heading"|"custom"; entryId?; level (0 page, 1-3 heading); indent? (display depth under a part);
 *             part? (the part divider it moves with); title; renamed; hidden;
 *             index? (heading: position in the chapter's outline, for editor jumps); page? (printed number text);
 *             stale? (custom entry whose `after` or `target` no longer resolves; an `after` that is the entry itself, part of a loop of
 *                     custom entries or a chain ending at a missing key counts as unresolved: the entry goes last);
 *             targetIndex? (custom entry whose `target` is a heading in the same resolved list, hidden-by-override ones included: that
 *                     heading's `index`; unset for page targets and for missing or beyond-depth headings) }
 *   StaleOverride { kind: "hidden"|"title"|"order"|"custom"; key; field?: "after"|"target" (custom only) }
 *   TocPageStart = { id: string; number: string }    (structurally a PageStart from export-pdf)
 *   Outlines = Record<entryId, OutlineItem[]>        (extractOutline of the chapter in the language being resolved)
 *
 * Reading
 *   DEFAULT_TOC: TocSettings                                     depth 0, page numbers on, no overrides
 *   TOC_UNLISTED_KINDS: readonly MatterKind[]                    kinds the list leaves out (title page, copyright, dedication, epigraph, colophon)
 *   tocSettingsOf(entry): TocSettings                            entry.toc or DEFAULT_TOC
 *   resolveToc(manifest, entry, language, outlines): TocItem[]   every item in display order, hidden ones included (flag `hidden`);
 *                                                                excludes contents pages and TOC_UNLISTED_KINDS; headings only up to depth.
 *                                                                A blank title (empty or whitespace) counts as missing: language override, entry title in
 *                                                                the language, source override, source title, finally the entry id
 *   visibleTocItems(items): TocItem[]                            drops hidden items (what an exporter writes)
 *   attachPages(items, starts, headingPages?): TocItem[]         sets `page` from entry starts (by id) and heading numbers (by key);
 *                                                                a custom entry takes its `target`'s number; missing or "" leaves `page` unset
 *   staleOverrides(entry, items): StaleOverride[]                overrides whose key is not in `items` (kept on disk, never dropped)
 *   Key helpers: normalizeHeadingText(text), headingKey(entryId, level, text, nth), customKey(id), isCustomKey(key),
 *                entryIdOfKey(key), outlineKeys(entryId, outline): string[] (aligned with `outline`)
 *
 * Editing (all pure: Manifest in, new Manifest out; throw Error when `contentsId` is not a contents page)
 *   setTocDepth(m, contentsId, depth)                  setTocPageNumbers(m, contentsId, on)
 *   renameTocItem(m, contentsId, key, language, title) trimmed; empty reverts a heading/page rename, throws for a custom entry
 *   hideTocItem(m, contentsId, key)                    showTocItem(m, contentsId, key)
 *   moveTocItem(m, contentsId, items, key, to)         `items` = current resolveToc result (hidden included); `to` is clamped;
 *                                                      stores the whole order; returns `m` itself when nothing moves
 *   addTocCustom(m, contentsId, { language, title, after, target? }): { manifest, key }
 *   removeTocCustom(m, contentsId, customId)
 *   removeTocOverride(m, contentsId, key)              clears hidden, rename and order slot of `key`; a `custom:` key removes the entry
 *   resetToc(m, contentsId)                            clears every override, keeps depth and page numbers
 *   migrateV6ToV7(raw)                                 migration step, no data change
 *
 * Order merge: `order` lists keys as the author last arranged them. Items missing from it (new chapters, new headings) slot in right
 * after the item that precedes them in reading order; keys in it that no longer exist are ignored (and reported as stale).
 */
import type { MatterKind } from "@cadabracraft/shared";
import {
  readingOrder,
  type EditionEntry,
  type Manifest,
  type TocCustom,
  type TocDepth,
  type TocSettings,
} from "./manifest";
import { sourceEdition } from "./editions";
import type { OutlineItem } from "./outline";

export type TocItemKind = "page" | "heading" | "custom";

export interface TocItem {
  key: string;
  kind: TocItemKind;
  /** Entry the item is in (page, heading) or points at (custom, when its target resolves). */
  entryId?: string;
  /** 0 for a page, 1 to 3 for a heading; a custom entry takes the level of the item it follows. */
  level: number;
  /**
   * Display depth when the item sits under a part divider: a chapter in a part is 1, its headings follow one deeper (H1 is 2, H3 is
   * 4). Absent means `level` is the display depth. Layout only: keys, depth and the manifest do not change.
   */
  indent?: number;
  /** The part divider this row is grouped under, so moving a part carries it. Absent at the top level; layout only. */
  part?: string;
  title: string;
  /** True when the author's text replaces the generated one (custom entries are never "renamed"). */
  renamed: boolean;
  hidden: boolean;
  /** Headings: position among the chapter's headings, empty ones included (what `extractOutline` calls `index`). */
  index?: number;
  /** Custom entries: the key it points at (its page number comes from there). */
  target?: string;
  /** Printed page number text, set by `attachPages`. */
  page?: string;
  /** Custom entries whose `target` is a heading in the same list (hidden ones included): that heading's `index`. */
  targetIndex?: number;
  /** Custom entries only: `after` or `target` no longer resolves. */
  stale?: boolean;
}

export interface StaleOverride {
  kind: "hidden" | "title" | "order" | "custom";
  key: string;
  /** Custom entries: which reference is dangling. */
  field?: "after" | "target";
}

export type Outlines = Readonly<Record<string, readonly OutlineItem[]>>;
export interface TocPageStart {
  id: string;
  number: string;
}

export const DEFAULT_TOC: TocSettings = {
  depth: 0,
  pageNumbers: true,
  parts: true,
  hidden: [],
  titles: {},
  custom: [],
};

/** Pages the list leaves out: they are not places a reader navigates to (same set the EPUB navigation leaves out). */
export const TOC_UNLISTED_KINDS: readonly MatterKind[] = [
  "blank",
  "title-page",
  "copyright",
  "dedication",
  "epigraph",
  "colophon",
];

export const tocSettingsOf = (entry: EditionEntry): TocSettings => entry.toc ?? DEFAULT_TOC;

// ---- keys ------------------------------------------------------------------------------------------

export const normalizeHeadingText = (text: string): string =>
  text.normalize("NFC").replace(/\s+/g, " ").trim().toLowerCase();

export const headingKey = (entryId: string, level: number, text: string, nth: number): string =>
  `${entryId}#${level}:${normalizeHeadingText(text)}:${nth}`;

export const customKey = (id: string): string => `custom:${id}`;
export const isCustomKey = (key: string): boolean => key.startsWith("custom:");

/** The entry id a page or heading key belongs to (a page key is its own entry id). Meaningless for custom keys. */
export const entryIdOfKey = (key: string): string => key.split("#", 1)[0]!;

/** Keys for a chapter's outline, same order as `outline`. Identical headings (same level and text) are told apart by occurrence. */
export function outlineKeys(entryId: string, outline: readonly OutlineItem[]): string[] {
  const seen = new Map<string, number>();
  return outline.map((h) => {
    const base = headingKey(entryId, h.level, h.text, 0);
    const nth = seen.get(base) ?? 0;
    seen.set(base, nth + 1);
    return headingKey(entryId, h.level, h.text, nth);
  });
}

// ---- resolving -------------------------------------------------------------------------------------

const isBlank = (text: string | undefined): text is undefined | "" =>
  text === undefined || text.trim() === "";

/**
 * Override for `key` in `language`, else the entry's own title in that language, else the source-language override, else the source
 * text, else `id`. A blank (empty or whitespace-only) candidate counts as missing, so a row is never blank; only a non-blank
 * override counts as a rename.
 */
function pickTitle(
  settings: TocSettings,
  key: string,
  language: string,
  own: string | undefined,
  fallback: string,
  source: string,
  id: string,
): { title: string; renamed: boolean } {
  const byLang = settings.titles[key];
  const over = byLang?.[language];
  if (!isBlank(over)) return { title: over, renamed: true };
  if (!isBlank(own)) return { title: own, renamed: false };
  const src = byLang?.[source];
  if (!isBlank(src)) return { title: src, renamed: true };
  return { title: isBlank(fallback) ? id : fallback, renamed: false };
}

function autoItems(
  manifest: Manifest,
  contents: EditionEntry,
  language: string,
  outlines: Outlines,
): TocItem[] {
  const settings = tocSettingsOf(contents);
  const source = sourceEdition(manifest.editions).language;
  // A chapter belongs to the part before it. Only chapters carry parts; front and back matter are never indented.
  const partOf = new Map<string, string>();
  let part: string | undefined;
  for (const entry of manifest.chapters) {
    // A hidden part has no row to nest under, so its chapters stay at the top level in the editor and in exports.
    if (entry.kind === "part") part = settings.hidden.includes(entry.id) ? undefined : entry.id;
    else if (part !== undefined && entry.kind !== "blank") partOf.set(entry.id, part);
  }
  const items: TocItem[] = [];
  for (const entry of readingOrder(manifest)) {
    if (entry.kind === "contents") continue;
    if (
      entry.kind !== undefined &&
      entry.kind !== "part" &&
      TOC_UNLISTED_KINDS.includes(entry.kind)
    )
      continue;
    // A part divider is listed only when the contents page asks for parts (the default); its own heading is its title, so it never
    // adds a second, heading-level row.
    if (entry.kind === "part" && !settings.parts) continue;
    // With parts off there is no parent row, so the chapters stay at the top level.
    const inPart = settings.parts ? partOf.get(entry.id) : undefined;
    // A part row itself is grouped under its own id; a hidden part has no row to group under, like its chapters.
    const itemPart =
      entry.kind === "part" ? (settings.hidden.includes(entry.id) ? undefined : entry.id) : inPart;
    const page = pickTitle(
      settings,
      entry.id,
      language,
      entry.titles[language],
      entry.titles[source]!,
      source,
      entry.id,
    );
    items.push({
      key: entry.id,
      kind: "page",
      entryId: entry.id,
      level: 0,
      ...(inPart === undefined ? {} : { indent: 1 }),
      ...(itemPart === undefined ? {} : { part: itemPart }),
      ...page,
      hidden: settings.hidden.includes(entry.id),
    });
    if (entry.kind === "part") continue;
    if (settings.depth === 0) continue;
    // Own properties only: an entry id such as "constructor" must not find a member of Object.prototype.
    const outline = Object.hasOwn(outlines, entry.id) ? outlines[entry.id]! : [];
    const keys = outlineKeys(entry.id, outline);
    outline.forEach((h, i) => {
      if (h.level > settings.depth) return;
      const key = keys[i]!;
      items.push({
        key,
        kind: "heading",
        entryId: entry.id,
        level: h.level,
        ...(inPart === undefined ? {} : { indent: 1 + h.level }),
        ...(itemPart === undefined ? {} : { part: itemPart }),
        ...pickTitle(settings, key, language, h.text, h.text, source, entry.id),
        hidden: settings.hidden.includes(key),
        index: h.index,
      });
    });
  }
  return items;
}

/**
 * Custom entries whose `after` leads nowhere: it is missing, or it follows other custom entries in a loop (itself included) or in a
 * chain that ends at a missing key. `anchors` are the keys of the generated items.
 */
function danglingAfter(custom: readonly TocCustom[], anchors: ReadonlySet<string>): Set<string> {
  const byKey = new Map(custom.map((c) => [customKey(c.id), c]));
  const dangling = new Set<string>();
  for (const c of custom) {
    const seen = new Set<string>();
    let at = c.after;
    while (isCustomKey(at) && byKey.has(at) && !seen.has(at)) {
      seen.add(at);
      at = byKey.get(at)!.after;
    }
    if (!anchors.has(at)) dangling.add(customKey(c.id));
  }
  return dangling;
}

/** Puts each custom entry after the item it follows (after the customs already there); the ones that cannot be placed go last. */
function insertCustom(
  auto: TocItem[],
  settings: TocSettings,
  language: string,
  source: string,
): TocItem[] {
  const result = [...auto];
  const keys = new Set(auto.map((i) => i.key));
  const dangling = danglingAfter(settings.custom, keys);
  for (const c of settings.custom) keys.add(customKey(c.id));
  const build = (c: TocCustom, level: number, indent?: number, part?: string): TocItem => {
    const target = c.target;
    const targetItem = target === undefined ? undefined : auto.find((i) => i.key === target);
    return {
      key: customKey(c.id),
      kind: "custom",
      ...(targetItem?.entryId === undefined ? {} : { entryId: targetItem.entryId }),
      ...(target === undefined ? {} : { target }),
      ...(targetItem?.kind === "heading" ? { targetIndex: targetItem.index! } : {}),
      level,
      ...(indent === undefined ? {} : { indent }),
      ...(part === undefined ? {} : { part }),
      title: c.titles[language] ?? c.titles[source] ?? Object.values(c.titles)[0]!,
      renamed: false,
      hidden: settings.hidden.includes(customKey(c.id)),
      stale: dangling.has(customKey(c.id)) || (target !== undefined && !keys.has(target)),
    };
  };
  let pending = [...settings.custom];
  for (let progress = true; progress && pending.length > 0;) {
    progress = false;
    const next: TocCustom[] = [];
    for (const c of pending) {
      const at = result.findIndex((i) => i.key === c.after);
      if (at < 0) {
        next.push(c);
        continue;
      }
      let end = at + 1;
      while (result[end]?.kind === "custom") end++;
      const anchor = result[at]!;
      result.splice(end, 0, build(c, anchor.level, anchor.indent, anchor.part));
      progress = true;
    }
    pending = next;
  }
  for (const c of pending) result.push(build(c, 0));
  return result;
}

function arrange(base: TocItem[], order: readonly string[] | undefined): TocItem[] {
  if (order === undefined) return base;
  const byKey = new Map(base.map((i) => [i.key, i]));
  const placed: TocItem[] = [];
  const seen = new Set<string>();
  for (const k of order) {
    const item = byKey.get(k);
    if (item === undefined || seen.has(k)) continue;
    placed.push(item);
    seen.add(k);
  }
  base.forEach((item, i) => {
    if (seen.has(item.key)) return;
    const prev = i === 0 ? undefined : base[i - 1]!.key;
    placed.splice(prev === undefined ? 0 : placed.findIndex((p) => p.key === prev) + 1, 0, item);
    seen.add(item.key);
  });
  return placed;
}

/**
 * The contents list in display order: generated items (reading order, headings up to the depth) plus the author's overrides.
 * `outlines` maps a chapter id to its outline in `language`; a chapter without one lists no headings. Hidden items are included
 * with `hidden: true` so an editor can show them; use `visibleTocItems` to write the list out.
 */
export function resolveToc(
  manifest: Manifest,
  entry: EditionEntry,
  language: string,
  outlines: Outlines,
): TocItem[] {
  const settings = tocSettingsOf(entry);
  const source = sourceEdition(manifest.editions).language;
  const auto = autoItems(manifest, entry, language, outlines);
  return arrange(insertCustom(auto, settings, language, source), settings.order);
}

export const visibleTocItems = <T extends { hidden?: boolean }>(items: readonly T[]): T[] =>
  items.filter((i) => !i.hidden);

/**
 * Sets the printed page number of each item. `starts` are the book's page starts (entry id and printed number, as the page report
 * has them), `headingPages` maps heading keys to numbers. A custom entry shows its target's number. No start, or a start whose page
 * prints no number (""), leaves `page` unset. Returns new items; the input is untouched.
 */
export function attachPages(
  items: readonly TocItem[],
  starts: readonly TocPageStart[],
  headingPages: Readonly<Record<string, string>> = {},
): TocItem[] {
  const byId = new Map(starts.map((s) => [s.id, s.number]));
  return items.map((item) => {
    const base = { ...item };
    delete base.page;
    const ref = item.kind === "custom" ? item.target : item.key;
    const page =
      ref === undefined
        ? undefined
        : (byId.get(ref) ?? (Object.hasOwn(headingPages, ref) ? headingPages[ref] : undefined));
    return page ? { ...base, page } : base;
  });
}

/**
 * Overrides that point at nothing: a hidden, renamed or ordered key that is not in `items` (its chapter or heading is gone or was
 * edited), and a custom entry whose `after` or `target` is missing. Pass the `resolveToc` result. They stay on disk so the author
 * decides; `removeTocOverride` clears one.
 */
export function staleOverrides(
  entry: EditionEntry,
  items: readonly TocItem[],
  /** Page keys that are deliberately not in the list (parts this contents page leaves out): their overrides are dormant, not stale. */
  ignored: readonly string[] = [],
): StaleOverride[] {
  const settings = tocSettingsOf(entry);
  const keys = new Set(items.map((i) => i.key));
  const skipped = new Set(ignored);
  const dangling = danglingAfter(
    settings.custom,
    new Set(items.filter((i) => i.kind !== "custom").map((i) => i.key)),
  );
  const out: StaleOverride[] = [];
  for (const key of settings.hidden)
    if (!keys.has(key) && !skipped.has(key)) out.push({ kind: "hidden", key });
  for (const key of Object.keys(settings.titles))
    if (!keys.has(key) && !skipped.has(key)) out.push({ kind: "title", key });
  for (const key of settings.order ?? [])
    if (!keys.has(key) && !skipped.has(key)) out.push({ kind: "order", key });
  for (const c of settings.custom) {
    const key = customKey(c.id);
    if (dangling.has(key)) out.push({ kind: "custom", key, field: "after" });
    if (c.target !== undefined && !keys.has(c.target))
      out.push({ kind: "custom", key, field: "target" });
  }
  return out;
}

// ---- editing ---------------------------------------------------------------------------------------

function update(
  m: Manifest,
  contentsId: string,
  change: (t: TocSettings) => TocSettings,
): Manifest {
  const entry = m.frontMatter.find((e) => e.id === contentsId);
  if (entry?.kind !== "contents") throw new Error(`no contents page ${contentsId}`);
  const toc = change(tocSettingsOf(entry));
  return {
    ...m,
    frontMatter: m.frontMatter.map((e) => (e.id === contentsId ? { ...e, toc } : e)),
  };
}

const without = (list: readonly string[], key: string): string[] => list.filter((k) => k !== key);

export const setTocDepth = (m: Manifest, contentsId: string, depth: TocDepth): Manifest =>
  update(m, contentsId, (t) => ({ ...t, depth }));

export const setTocPageNumbers = (
  m: Manifest,
  contentsId: string,
  pageNumbers: boolean,
): Manifest => update(m, contentsId, (t) => ({ ...t, pageNumbers }));

/** Whether this contents page lists the book's part dividers (the default) or leaves them out. */
export const setTocParts = (m: Manifest, contentsId: string, parts: boolean): Manifest =>
  update(m, contentsId, (t) => ({ ...t, parts }));

/** Sets the text of an item in one language. For a page or heading an empty text removes the rename; a custom entry needs text. */
export function renameTocItem(
  m: Manifest,
  contentsId: string,
  key: string,
  language: string,
  title: string,
): Manifest {
  const text = title.trim();
  return update(m, contentsId, (t) => {
    if (isCustomKey(key)) {
      if (text === "") throw new Error("A custom contents entry needs a title");
      if (!t.custom.some((c) => customKey(c.id) === key))
        throw new Error(`no contents item ${key}`);
      return {
        ...t,
        custom: t.custom.map((c) =>
          customKey(c.id) === key ? { ...c, titles: { ...c.titles, [language]: text } } : c,
        ),
      };
    }
    const { [key]: current = {}, ...others } = t.titles;
    if (text !== "")
      return { ...t, titles: { ...others, [key]: { ...current, [language]: text } } };
    const { [language]: _gone, ...left } = current;
    return {
      ...t,
      titles: Object.keys(left).length > 0 ? { ...others, [key]: left } : others,
    };
  });
}

export const hideTocItem = (m: Manifest, contentsId: string, key: string): Manifest =>
  update(m, contentsId, (t) => ({ ...t, hidden: [...without(t.hidden, key), key] }));

export const showTocItem = (m: Manifest, contentsId: string, key: string): Manifest =>
  update(m, contentsId, (t) => ({ ...t, hidden: without(t.hidden, key) }));

interface TocBlock {
  start: number;
  end: number;
  part?: string;
}

/** Runs of rows that move together: a part row and the continuous rows carrying its id, or a single top-level row. */
function blocksOf(items: readonly TocItem[]): TocBlock[] {
  const blocks: TocBlock[] = [];
  for (let start = 0; start < items.length;) {
    const part = items[start]!.part;
    let end = start + 1;
    if (part !== undefined) while (end < items.length && items[end]!.part === part) end++;
    blocks.push({ start, end, part });
    start = end;
  }
  return blocks;
}

const blockAt = (blocks: readonly TocBlock[], index: number): TocBlock =>
  blocks.find((b) => index >= b.start && index < b.end)!;

/**
 * Moves `key` to position `to` of the displayed list (clamped) and stores the whole order. A part row moves its whole block;
 * a row inside a part stays inside it; a top-level row is placed before or after a part block, never inside it. Returns `m` itself
 * when nothing moves.
 */
export function moveTocItem(
  m: Manifest,
  contentsId: string,
  items: readonly TocItem[],
  key: string,
  to: number,
): Manifest {
  const keys = items.map((i) => i.key);
  const from = keys.indexOf(key);
  if (from < 0) throw new Error(`no contents item ${key}`);
  const target = Math.min(keys.length - 1, Math.max(0, to));
  if (target === from) return m;
  const item = items[from]!;
  const blocks = blocksOf(items);
  const source = blockAt(blocks, from);
  const isPart = item.part !== undefined && item.key === item.part;
  if (item.part !== undefined && !isPart) {
    // A chapter, heading or custom entry inside a part can move within its block, never out of it.
    const min = source.start + (items[source.start]!.key === item.part ? 1 : 0);
    const at = Math.min(source.end - 1, Math.max(min, target));
    if (at === from) return m;
    keys.splice(from, 1);
    keys.splice(at, 0, key);
  } else {
    const destination = blockAt(blocks, target);
    // Dropping a part or top-level row into its own block changes nothing.
    if (destination === source) return m;
    const block = keys.slice(source.start, source.end);
    // Down goes after the destination block, up before it. The source is already out of the list when the block is inserted.
    const at = target > from ? destination.end - block.length : destination.start;
    const next = keys.filter((_, i) => i < source.start || i >= source.end);
    next.splice(at, 0, ...block);
    if (next.every((k, i) => k === keys[i])) return m;
    keys.length = 0;
    keys.push(...next);
  }
  return update(m, contentsId, (t) => ({ ...t, order: keys }));
}

/** Adds a custom entry after the item `after`. Its id is `c-N`, the first not in use. */
export function addTocCustom(
  m: Manifest,
  contentsId: string,
  init: { language: string; title: string; after: string; target?: string },
): { manifest: Manifest; key: string } {
  const title = init.title.trim();
  if (title === "") throw new Error("A custom contents entry needs a title");
  let key = "";
  const manifest = update(m, contentsId, (t) => {
    let n = t.custom.length + 1;
    while (t.custom.some((c) => c.id === `c-${n}`)) n++;
    key = customKey(`c-${n}`);
    const entry: TocCustom = {
      id: `c-${n}`,
      titles: { [init.language]: title },
      after: init.after,
      ...(init.target === undefined ? {} : { target: init.target }),
    };
    return { ...t, custom: [...t.custom, entry] };
  });
  return { manifest, key };
}

export function removeTocCustom(m: Manifest, contentsId: string, customId: string): Manifest {
  const key = customKey(customId);
  return update(m, contentsId, (t) => {
    if (!t.custom.some((c) => c.id === customId))
      throw new Error(`no custom contents entry ${customId}`);
    return {
      ...t,
      custom: t.custom.filter((c) => c.id !== customId),
      hidden: without(t.hidden, key),
      ...(t.order === undefined ? {} : { order: without(t.order, key) }),
    };
  });
}

/** Clears what the author set for one item: hidden, renamed, its place in the order; a `custom:` key removes that entry. */
export function removeTocOverride(m: Manifest, contentsId: string, key: string): Manifest {
  if (isCustomKey(key)) {
    const id = key.slice("custom:".length);
    const entry = m.frontMatter.find((e) => e.id === contentsId);
    // A `custom:` key whose entry is gone is a stale override (hidden or ordered): it is cleared below like any other key.
    if (entry !== undefined && tocSettingsOf(entry).custom.some((c) => c.id === id))
      return removeTocCustom(m, contentsId, id);
  }
  return update(m, contentsId, (t) => {
    const { [key]: _gone, ...titles } = t.titles;
    return {
      ...t,
      hidden: without(t.hidden, key),
      titles,
      ...(t.order === undefined ? {} : { order: without(t.order, key) }),
    };
  });
}

/** Back to the generated list: every override goes, depth and the page-number switch stay. */
export const resetToc = (m: Manifest, contentsId: string): Manifest =>
  update(m, contentsId, (t) => ({
    depth: t.depth,
    pageNumbers: t.pageNumbers,
    parts: t.parts,
    hidden: [],
    titles: {},
    custom: [],
  }));

/** Migration step: formatVersion 6 -> 7. Nothing to change: `toc` is optional and absent means the defaults. */
export const migrateV6ToV7 = (raw: Record<string, unknown>): Record<string, unknown> => ({
  ...raw,
});
