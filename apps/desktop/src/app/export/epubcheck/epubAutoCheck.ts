import { create } from "zustand";
import { useSettings } from "../../../state/view/editorPrefs";

/** Raised after an EPUB export while "check the EPUB after every export" is on; the EPUB panel runs EPUBCheck when it changes. */
export const useEpubCheckSignal = create<{ signal: number }>(() => ({ signal: 0 }));

/**
 * Called by the Export dialog after an EPUB export. With the preference on it raises the signal and returns true, and the dialog stays
 * open so the EPUBCheck result is seen; with it off it returns false and the dialog closes as usual.
 */
export function raiseEpubCheck(): boolean {
  if (!useSettings.getState().validateEpub) return false;
  useEpubCheckSignal.setState((s) => ({ signal: s.signal + 1 }));
  return true;
}
