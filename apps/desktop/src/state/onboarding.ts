import { create } from "zustand";
import { readStored, writeStored } from "../lib/persisted";

const KEY = "cadabracraft.onboarding";

/**
 * The welcome screen is an app preference, never a project fact: "seen" is written when the author leaves it, and a
 * missing or unreadable value means this is the first run.
 */
const readSeen = (): boolean => readStored(KEY) === "seen";

export const useOnboarding = create<{ seen: boolean; markSeen: () => void }>((set) => ({
  seen: readSeen(),
  markSeen: () => {
    writeStored(KEY, "seen");
    set({ seen: true });
  },
}));
