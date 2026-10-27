import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

/** Watching the open project for edits made outside the app. */
export const watchBridge = {
  watchProject: (root: string) => invoke<void>("watch_project", { root }),
  /** Calls back with the project-relative path of each file changed outside the app. Returns an unsubscribe function. */
  onProjectChanged: (cb: (path: string) => void) => listen<string>("project-changed", (e) => cb(e.payload)).then((un) => un),
};
