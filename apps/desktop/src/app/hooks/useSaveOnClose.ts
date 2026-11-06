import { useEffect } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { closeRequest } from "../shell/native/quit";
import { useProject } from "../../state/project/index";

/**
 * Writes unsaved typing when the window is closed. Autosave covers the usual case; this covers closing within its
 * delay. The native close request is held back until the write has finished (see `createCloseHandler`). In a plain
 * browser (tests, `vite` alone) there is no native window, so only the best-effort `beforeunload` and `pagehide` writes
 * apply: the page cannot wait for them.
 */
export function useSaveOnClose() {
  useEffect(() => {
    const save = () => {
      if (useProject.getState().draft)
        void useProject
          .getState()
          .actions.flush()
          .catch(() => {});
    };
    window.addEventListener("beforeunload", save);
    window.addEventListener("pagehide", save);

    let unlisten: (() => void) | undefined;
    let gone = false;
    try {
      const win = getCurrentWindow();
      win.onCloseRequested(closeRequest).then(
        (un) => {
          if (gone) un();
          else unlisten = un;
        },
        () => {},
      );
    } catch {
      // Not running inside Tauri.
    }

    return () => {
      gone = true;
      unlisten?.();
      window.removeEventListener("beforeunload", save);
      window.removeEventListener("pagehide", save);
    };
  }, []);
}
