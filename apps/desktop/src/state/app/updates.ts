import type { Update } from "@tauri-apps/plugin-updater";
import { create } from "zustand";
import { bridge } from "../../lib/bridge";
import { useProject } from "../project/index";
import { readStored, writeStored } from "../../lib/persisted";
import { errText, whyText } from "../../lib/projectError";

const KEY = "cadabracraft.updates";

/** "Check for updates on launch" is on unless the author switched it off. App preference only; never stored in project files. */
const readCheckOnLaunch = (): boolean => readStored(KEY) !== "off";
const writeCheckOnLaunch = (on: boolean) => writeStored(KEY, on ? "on" : "off");

export type UpdateStatus =
  | { kind: "idle" }
  | { kind: "checking" }
  | { kind: "current" }
  | { kind: "available"; update: Update }
  | { kind: "installing" }
  /** This copy is updated by its package manager (a Linux package other than an AppImage). */
  | { kind: "unsupported" }
  /** `update` is set when an install failed, so Install can be tried again without checking first. */
  | { kind: "error"; message: string; update?: Update };

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
      if (!(await bridge.updatesSupported())) {
        set({ status: { kind: "unsupported" } });
        return;
      }
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
    const update =
      status.kind === "available"
        ? status.update
        : status.kind === "error"
          ? status.update
          : undefined;
    if (!update) return;
    set({ status: { kind: "installing" } });
    try {
      // The relaunch ends the process without a close request, so unsaved typing is written first; a failure aborts.
      await useProject.getState().actions.flush();
      await update.downloadAndInstall();
      await useProject.getState().actions.flush();
      await bridge.relaunch();
    } catch (e) {
      set({ status: { kind: "error", message: whyText(e), update }, dialogOpen: true });
    }
  },
}));
