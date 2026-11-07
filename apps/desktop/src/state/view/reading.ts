import { createPersistedStore } from "../../lib/persisted";

/** Text sizes in rem, smallest to largest. */
export const sizes = [1.0625, 1.1875, 1.3125, 1.4375, 1.5625];
export type Width = "narrow" | "wide";
export const widths: Record<Width, number> = { narrow: 560, wide: 740 };

interface Prefs {
  size: number;
  width: Width;
}
const defaults: Prefs = { size: 2, width: "narrow" };

/** Reading-mode preferences. App preference only; never stored in project files. */
export const useReading = createPersistedStore<Prefs>({
  key: "cadabracraft.reading",
  defaults,
  parse: (v) => {
    const o = v as Partial<Prefs> | null;
    return o &&
      Number.isInteger(o.size) &&
      o.size! >= 0 &&
      o.size! < sizes.length &&
      (o.width === "narrow" || o.width === "wide")
      ? { size: o.size!, width: o.width }
      : null;
  },
  clean: (p) => ({ size: Math.min(sizes.length - 1, Math.max(0, p.size)), width: p.width }),
});
