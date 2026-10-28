import { create } from "zustand";
import { readStored, writeStored } from "../lib/persisted";

const KEY = "cadabracraft.sponsor";

/** Where "Sponsor" goes. Opened in the author's own browser; the app itself makes no network request. */
export const SPONSOR_URL = "https://github.com/sponsors/RabinApps";

/** "Don't show again" is an app preference only; never stored in project files. */
const readHidden = (): boolean => readStored(KEY) === "hidden";
const writeHidden = () => writeStored(KEY, "hidden");

interface Sponsor {
  /** Set while the dialog is open: what was just exported (`exports/book.epub`). */
  exported: string | null;
  /** "Maybe later": no more offers until the app is restarted. */
  later: boolean;
  /** "Don't show again": no more offers, remembered. */
  hidden: boolean;
  /** Called after a successful export; opens the dialog unless the author declined it. */
  offer: (file: string) => void;
  /** "Maybe later": closes the dialog and stays quiet for this session. */
  snooze: () => void;
  /** "Don't show again": closes the dialog and remembers it. */
  never: () => void;
  /** Closes the dialog without choosing (Escape, clicking outside, after pressing Sponsor): the next export asks again. */
  close: () => void;
}

export const useSponsor = create<Sponsor>((set, get) => ({
  exported: null,
  later: false,
  hidden: readHidden(),
  offer: (file) => {
    if (!get().hidden && !get().later) set({ exported: file });
  },
  snooze: () => set({ exported: null, later: true }),
  never: () => {
    writeHidden();
    set({ exported: null, hidden: true });
  },
  close: () => set({ exported: null }),
}));
