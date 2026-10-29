import { create } from "zustand";
import { KDP_BLEED_IN } from "../lib/exportChecks";

/**
 * The print PDF's bleed and crop marks, shared by the Export dialog and the print preview so both describe the same file. Kept for
 * the session only (a printer's needs differ per book and per run); the dialog starts with neither.
 */
export const usePrintSetup = create<{ bleed: boolean; cropMarks: boolean }>(() => ({
  bleed: false,
  cropMarks: false,
}));

/** Turning bleed off turns crop marks off too: they are drawn outside the bleed. */
export const setBleed = (bleed: boolean): void =>
  usePrintSetup.setState((s) => ({ bleed, cropMarks: bleed && s.cropMarks }));

/** Crop marks need a bleed; turning them on turns it on. */
export const setCropMarks = (cropMarks: boolean): void =>
  usePrintSetup.setState((s) => ({ cropMarks, bleed: s.bleed || cropMarks }));

/** The bleed to pass to the export in inches: 0.125 when on, else 0. */
export const bleedInches = (bleed: boolean): number => (bleed ? KDP_BLEED_IN : 0);
