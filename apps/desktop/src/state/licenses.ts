import { create } from "zustand";

/** The documents Help > Licenses lists, in order. The ids are the ones `read_license` accepts. */
export const LICENSE_DOCS = [
  "license",
  "clarifications",
  "notice",
  "programs",
  "rust",
  "npm",
] as const;
export type LicenseDoc = (typeof LICENSE_DOCS)[number];

interface Licenses {
  open: boolean;
  show: () => void;
  close: () => void;
}

export const useLicenses = create<Licenses>((set) => ({
  open: false,
  show: () => set({ open: true }),
  close: () => set({ open: false }),
}));
