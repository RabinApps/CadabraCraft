import { useEffect } from "react";
import { useProject } from "./store";

/**
 * Writes unsaved typing when the window is closed or reloaded. Autosave covers the usual case; this covers closing within
 * its delay. The write starts synchronously from the event (the page cannot wait for it), so it is best effort.
 */
export function useSaveOnClose() {
  useEffect(() => {
    const save = () => { if (useProject.getState().draft) void useProject.getState().actions.flush().catch(() => {}); };
    window.addEventListener("beforeunload", save);
    window.addEventListener("pagehide", save);
    return () => {
      window.removeEventListener("beforeunload", save);
      window.removeEventListener("pagehide", save);
    };
  }, []);
}
