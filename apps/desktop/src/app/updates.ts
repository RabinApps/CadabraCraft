import type { Update } from "@tauri-apps/plugin-updater";
import { create } from "zustand";
import { bridge } from "../lib/bridge";
import { errText } from "../lib/projectError";

const KEY = "cadabracraft.updates";

/** "Check for updates on launch" is on unless the author switched it off. App preference only; never stored in project files. */
function readCheckOnLaunch(): boolean {
  try { return localStorage.getItem(KEY) !== "off"; } catch { return true; }
}
function writeCheckOnLaunch(on: boolean) {
  try { localStorage.setItem(KEY, on ? "on" : "off"); } catch { /* keep it for this session only */ }
}

export type UpdateStatus =
  | { kind: "idle" }
  | { kind: "checking" }
  | { kind: "current" }
  | { kind: "available"; update: Update }
  | { kind: "installing" }
  | { kind: "error"; message: string };

interface Updates {
  checkOnLaunch: boolean;
  status: UpdateStatus;
  /** Open while an available update is on offer (or an install failed). */
  dialogOpen: boolean;
  setCheckOnLaunch: (on: boolean) => void;
  /** Asks GitHub Releases whether a newer version exists. A launch check stays silent unless it finds one; a manual check always reports. */
  check: (manual: boolean) => Promise<void>;
  /** "Later": closes the dialog; the next launch asks again. */
  later: () => void;
  /** Downloads the update, checks its signature, installs it and restarts. The author must press Install now. */
  install: () => Promise<void>;
}

export const useUpdates = create<Updates>((set, get) => ({
  checkOnLaunch: readCheckOnLaunch(),
  status: { kind: "idle" },
  dialogOpen: false,
  setCheckOnLaunch: (on) => {
    writeCheckOnLaunch(on);
    set({ checkOnLaunch: on });
  },
  check: async (manual) => {
    if (!manual && !get().checkOnLaunch) return;
    const busy = get().status.kind;
    if (busy === "checking" || busy === "installing") return;
    set({ status: { kind: "checking" } });
    try {
      const update = await bridge.checkForUpdate();
      if (update) {
        set({ status: { kind: "available", update }, dialogOpen: true });
      } else {
        set({ status: { kind: "current" } });
      }
    } catch (e) {
      set({ status: manual ? { kind: "error", message: errText(e) } : { kind: "idle" } });
    }
  },
  later: () => set({ dialogOpen: false }),
  install: async () => {
    const { status } = get();
    if (status.kind !== "available") return;
    set({ status: { kind: "installing" } });
    try {
      await status.update.downloadAndInstall();
      await bridge.relaunch();
    } catch (e) {
      set({ status: { kind: "error", message: errText(e) }, dialogOpen: true });
    }
  },
}));
