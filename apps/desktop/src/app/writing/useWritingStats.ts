import { useEffect, useState } from "react";
import type { WritingFile } from "@cadabracraft/shared";
import { errText } from "../../lib/projectError";
import { bridgeStatsIo } from "../../lib/writing/bridgeStats";
import { updateWritingStats } from "../../lib/writing/statsFile";
import { useProject } from "../../state/project/index";

export interface WritingStatsState {
  file: WritingFile | null;
  /** The copy kept of an unreadable stats file, when there was one. */
  backup: string | null;
  error: string | null;
}

/** The writing history of the open book, read each time the screen opens. */
export function useWritingStats(open: boolean): WritingStatsState {
  const root = useProject((s) => s.root);
  const [state, setState] = useState<WritingStatsState>({ file: null, backup: null, error: null });
  useEffect(() => {
    if (!open || !root) return;
    let live = true;
    setState({ file: null, backup: null, error: null });
    updateWritingStats(bridgeStatsIo(root), (file) => file, new Date())
      .then(({ file, backup }) => live && setState({ file, backup, error: null }))
      .catch((e: unknown) => live && setState({ file: null, backup: null, error: errText(e) }));
    return () => {
      live = false;
    };
  }, [open, root]);
  return state;
}
