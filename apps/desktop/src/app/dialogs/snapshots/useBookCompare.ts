import { useEffect, useState } from "react";
import type { BookSnapshotEntry } from "../../../lib/bridge";
import { useProject } from "../../../state/project/index";
import { loadBookCompare, type BookCompare } from "./compareBookPage";

/** Compares the chapter `file` in the chosen book snapshot with the current text; idle without a chapter or a snapshot. */
export function useBookCompare(
  root: string | null,
  snapshot: BookSnapshotEntry | undefined,
  file: string | undefined,
): BookCompare {
  const actions = useProject((s) => s.actions);
  const [state, setState] = useState<BookCompare>({ status: "idle" });
  const path = snapshot?.path;
  useEffect(() => {
    if (!root || !snapshot || !file) {
      setState({ status: "idle" });
      return;
    }
    let live = true;
    setState({ status: "loading" });
    void (async () => {
      try {
        await actions.flush(); // so "the current text" is what is on disk
      } catch {
        // the read below shows what is on disk
      }
      const next = await loadBookCompare(root, snapshot, file);
      if (live) setState(next);
    })();
    return () => {
      live = false;
    };
  }, [root, path, file, actions]);
  return state;
}
