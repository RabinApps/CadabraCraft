/**
 * Names an author can give a page as its sidebar icon (the entry's `icon`). The names are Lucide icon names; the app maps
 * each to a component. A name outside this list (written by a newer app) is kept in the file and shown as no icon.
 */
export const ENTRY_ICONS = [
  "book-open",
  "feather",
  "scroll",
  "map",
  "compass",
  "anchor",
  "ship",
  "mountain",
  "trees",
  "leaf",
  "sun",
  "moon",
  "cloud-lightning",
  "flame",
  "star",
  "heart",
  "skull",
  "ghost",
  "eye",
  "key",
  "gem",
  "crown",
  "castle",
  "shield",
  "swords",
  "wand-sparkles",
  "bird",
  "flag",
  "music",
] as const;

export type EntryIcon = (typeof ENTRY_ICONS)[number];

export const isEntryIcon = (v: unknown): v is EntryIcon =>
  typeof v === "string" && (ENTRY_ICONS as readonly string[]).includes(v);
