import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { relaunch } from "@tauri-apps/plugin-process";
import { check, type Update } from "@tauri-apps/plugin-updater";

/** The app itself: the browser, updates and restart. */
export const systemBridge = {
  /** Opens a web address in the author's default browser (the opener plugin only allows the sponsor page, see capabilities/default.json). */
  openUrl: (url: string) => openUrl(url),
  /** Asks the update endpoint (GitHub Releases) for a newer version; `null` when this is the latest. The only request the app makes on its own. */
  checkForUpdate: (): Promise<Update | null> => check(),
  /** False for a Linux package that is not an AppImage: the updater cannot replace it, so no update is offered. */
  updatesSupported: () => invoke<boolean>("updates_supported"),
  /** The text of one bundled license document (`license`, `clarifications`, `notice`, `programs`, `rust`, `npm`). */
  readLicense: (id: string) => invoke<string>("read_license", { id }),
  /** Restarts the app once an update has been installed. */
  relaunch: () => relaunch(),
};
