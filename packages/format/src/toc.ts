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
export * from "./toc/types";
export * from "./toc/keys";
export * from "./toc/resolve";
export * from "./toc/edit";
