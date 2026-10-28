import type { InstalledFont } from "./bridge";

export type FontSource = "bundled" | "installed" | "downloaded" | "imported";
export interface FontEntry {
  family: string;
  source: FontSource;
  /** The id in the app's fonts folder (downloaded and imported fonts only), for Delete. */
  id?: string;
}

/** The two families that come with the app (the editor's `newsreader` and `inter` choices). */
export const BUNDLED_FAMILIES = ["Newsreader", "Inter"] as const;

const byName = (a: FontEntry, b: FontEntry) =>
  a.family.localeCompare(b.family, undefined, { sensitivity: "base" });

/**
 * Every family the author can use: the bundled ones first, then the rest by name. The app's own (downloaded and imported) fonts win
 * over a system font of the same name; names are compared without case.
 */
export function mergeFonts(system: string[], kept: InstalledFont[]): FontEntry[] {
  const seen = new Set<string>(BUNDLED_FAMILIES.map((f) => f.toLowerCase()));
  const rest: FontEntry[] = [];
  const add = (e: FontEntry) => {
    const k = e.family.toLowerCase();
    if (seen.has(k)) return;
    seen.add(k);
    rest.push(e);
  };
  for (const f of kept) add({ family: f.family, source: f.source, id: f.id });
  for (const family of system) if (family.trim()) add({ family, source: "installed" });
  return [
    ...BUNDLED_FAMILIES.map((family) => ({ family, source: "bundled" as const })),
    ...rest.sort(byName),
  ];
}

/** Family names Typst can use for the print and Word selects: the system's and the app's own, deduplicated by name (without case) and sorted. */
export function printFamilies(system: string[], kept: InstalledFont[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const family of [...kept.map((k) => k.family), ...system]) {
    const k = family.trim().toLowerCase();
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(family);
  }
  return out.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
}

/** Megabytes with one decimal ("2.4"), in the author's number format. */
export const formatMb = (bytes: number): string =>
  new Intl.NumberFormat(undefined, { maximumFractionDigits: 1, minimumFractionDigits: 1 }).format(
    bytes / 1e6,
  );
