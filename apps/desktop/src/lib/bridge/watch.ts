import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

/** Watching the open project for edits made outside the app. */
export const watchBridge = {
  watchProject: (root: string) => invoke<void>("watch_project", { root }),
  /** Stops watching (a project closed). Safe when nothing is watched. */
  unwatchProject: () => invoke<void>("unwatch_project"),
  /** Calls back with the project-relative path of each file changed outside the app. Returns an unsubscribe function. */
  onProjectChanged: (cb: (path: string) => void) =>
    listen<string>("project-changed", (e) => cb(e.payload)).then((un) => un),
  /** Calls back when the watcher fails after it started, so outside edits may go unnoticed. Returns an unsubscribe function. */
  onProjectWatchError: (cb: () => void) =>
    listen<string>("project-watch-error", () => cb()).then((un) => un),
};
