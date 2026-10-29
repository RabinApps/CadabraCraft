import { rank } from "../../lib/fuzzy";
import type { OutlineItem } from "../../lib/outline";
import type { MenuEntry } from "../shell/menuModel";

/**
 * What the command palette and the outline navigator list, as plain data. Both are built from data the app already has: the
 * palette from the menu model (so it shows exactly the menu's commands, their availability, ticks and shortcuts), the outline
 * from the open chapter's headings and the book's pages. The components only draw these rows.
 */

export interface PaletteEntry {
  /** Unique: the command id, plus its argument for items that carry one (recent projects). */
  key: string;
  id: string;
  arg?: string;
  label: string;
  /** The menus it sits in, outermost first: "File · Export". */
  category: string;
  enabled: boolean;
  checked?: boolean;
  /** Menu accelerator (`CmdOrCtrl+Shift+N`), if it has one. */
  accelerator?: string;
}

/** Menu items the palette leaves out: itself, and the placeholder shown when there are no recent projects. */
const HIDDEN = new Set(["view.palette", "file.none"]);

/** Separates the menu names in a category. A dot has no direction, so it reads the same in right-to-left text. */
const SEPARATOR = " · ";

/** Every command of the menu model, in menu order, once (the menu can list a command twice, e.g. Settings on some systems). */
export function paletteEntries(model: readonly MenuEntry[]): PaletteEntry[] {
  const seen = new Set<string>();
  const out: PaletteEntry[] = [];
  const walk = (entries: readonly MenuEntry[], path: readonly string[]) => {
    for (const e of entries) {
      if (e.kind === "submenu") walk(e.items, [...path, e.text]);
      if (e.kind !== "command" || HIDDEN.has(e.id)) continue;
      const key = e.arg === undefined ? e.id : `${e.id}\u0000${e.arg}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({
        key,
        id: e.id,
        ...(e.arg === undefined ? {} : { arg: e.arg }),
        label: e.text,
        category: path.join(SEPARATOR),
        enabled: e.enabled,
        ...(e.checked === undefined ? {} : { checked: e.checked }),
        ...(e.accelerator ? { accelerator: e.accelerator } : {}),
      });
    }
  };
  walk(model, []);
  return out;
}

export interface PaletteResult {
  entry: PaletteEntry;
  positions: number[];
}

/** The entries that match the query, best first. An empty query lists everything in menu order. */
export function paletteResults(entries: readonly PaletteEntry[], query: string): PaletteResult[] {
  return rank(
    entries,
    query,
    (e) => e.label,
    (e) => e.category,
  ).map(({ item, positions }) => ({ entry: item, positions }));
}

export type OutlineGroup = "headings" | "chapters";

export interface OutlineEntry {
  key: string;
  group: OutlineGroup;
  label: string;
  /** Headings only: 1 to 3, and the heading's number in the chapter (what the editor jumps by). */
  level?: number;
  headingIndex?: number;
  /** Chapters only. */
  pageId?: string;
  /** The open chapter. */
  current?: boolean;
}

/** The open chapter's headings first, then every page of the book in reading order. */
export function outlineEntries(
  headings: readonly OutlineItem[],
  pages: readonly { id: string; title: string }[],
  currentId: string | null,
): OutlineEntry[] {
  return [
    ...headings.map((h): OutlineEntry => ({
      key: `heading:${h.index}`,
      group: "headings",
      label: h.text,
      level: h.level,
      headingIndex: h.index,
    })),
    ...pages.map((p): OutlineEntry => ({
      key: `page:${p.id}`,
      group: "chapters",
      label: p.title,
      pageId: p.id,
      ...(p.id === currentId ? { current: true } : {}),
    })),
  ];
}

export interface OutlineResult {
  entry: OutlineEntry;
  positions: number[];
}

/** The entries that match the query; within each group, best first. An empty query keeps the book's order. */
export function outlineResults(entries: readonly OutlineEntry[], query: string): OutlineResult[] {
  const matched = rank(entries, query, (e) => e.label).map(({ item, positions }) => ({
    entry: item,
    positions,
  }));
  return (["headings", "chapters"] as const).flatMap((g) =>
    matched.filter((r) => r.entry.group === g),
  );
}
