import type { Manifest, TocCustom, TocDepth, TocSettings } from "../manifest";
import { customKey, isCustomKey } from "./keys";
import { tocSettingsOf, type TocItem } from "./types";

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
