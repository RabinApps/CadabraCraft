import {
  readingOrder,
  type EditionEntry,
  type Manifest,
  type TocCustom,
  type TocSettings,
} from "../manifest";
import { sourceEdition } from "../editions";
import { customKey, isCustomKey, outlineKeys } from "./keys";
import {
  TOC_UNLISTED_KINDS,
  tocSettingsOf,
  type Outlines,
  type StaleOverride,
  type TocItem,
  type TocPageStart,
} from "./types";

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
  candidates: { own: string | undefined; fallback: string; source: string; id: string },
): { title: string; renamed: boolean } {
  const { own, fallback, source, id } = candidates;
  const byLang = settings.titles[key];
  const over = byLang?.[language];
  if (!isBlank(over)) return { title: over, renamed: true };
  if (!isBlank(own)) return { title: own, renamed: false };
  const src = byLang?.[source];
  if (!isBlank(src)) return { title: src, renamed: true };
  return { title: isBlank(fallback) ? id : fallback, renamed: false };
}

/** A chapter belongs to the part before it. Only chapters carry parts; front and back matter are never indented. */
function partsByChapter(manifest: Manifest, settings: TocSettings): Map<string, string> {
  const partOf = new Map<string, string>();
  let part: string | undefined;
  for (const entry of manifest.chapters) {
    // A hidden part has no row to nest under, so its chapters stay at the top level in the editor and in exports.
    if (entry.kind === "part") part = settings.hidden.includes(entry.id) ? undefined : entry.id;
    else if (part !== undefined && entry.kind !== "blank") partOf.set(entry.id, part);
  }
  return partOf;
}

/** Whether the contents page lists `entry` at all. */
function isListed(entry: EditionEntry, settings: TocSettings): boolean {
  if (entry.kind === "contents") return false;
  if (entry.kind !== undefined && entry.kind !== "part" && TOC_UNLISTED_KINDS.includes(entry.kind))
    return false;
  // A part divider is listed only when the contents page asks for parts (the default); its own heading is its title, so it never
  // adds a second, heading-level row.
  return !(entry.kind === "part" && !settings.parts);
}

function autoItems(
  manifest: Manifest,
  contents: EditionEntry,
  language: string,
  outlines: Outlines,
): TocItem[] {
  const settings = tocSettingsOf(contents);
  const source = sourceEdition(manifest.editions).language;
  const partOf = partsByChapter(manifest, settings);
  const items: TocItem[] = [];
  for (const entry of readingOrder(manifest)) {
    if (!isListed(entry, settings)) continue;
    // With parts off there is no parent row, so the chapters stay at the top level.
    const inPart = settings.parts ? partOf.get(entry.id) : undefined;
    // A part row itself is grouped under its own id; a hidden part has no row to group under, like its chapters.
    const itemPart =
      entry.kind === "part" ? (settings.hidden.includes(entry.id) ? undefined : entry.id) : inPart;
    const page = pickTitle(settings, entry.id, language, {
      own: entry.titles[language],
      fallback: entry.titles[source]!,
      source,
      id: entry.id,
    });
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
    if (entry.kind === "part" || settings.depth === 0) continue;
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
        ...pickTitle(settings, key, language, {
          own: h.text,
          fallback: h.text,
          source,
          id: entry.id,
        }),
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
