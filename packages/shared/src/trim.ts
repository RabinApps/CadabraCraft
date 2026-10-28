/** Print page sizes in inches (width x height). Matches `TrimSizeId` in `@cadabracraft/templates`. */
export const TRIM_SIZE_IDS = [
  "4.25x6.87",
  "5x8",
  "5.25x8",
  "5.5x8.5",
  "6x9",
  "7x10",
  "8.5x11",
] as const;

export type TrimSize = (typeof TRIM_SIZE_IDS)[number];

export const isTrimSize = (v: unknown): v is TrimSize =>
  typeof v === "string" && (TRIM_SIZE_IDS as readonly string[]).includes(v);
