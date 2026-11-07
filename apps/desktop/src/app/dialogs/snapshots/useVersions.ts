import { useEffect, useState } from "react";
import { useLingui } from "@lingui/react/macro";
import { bridge, type SnapshotEntry } from "../../../lib/bridge";
import { causeText } from "../../../lib/projectError";
import { useProject } from "../../../state/project/index";
import { compareWithCurrent, readCurrentParagraphs, type Compared } from "./chapterCompare";

/** Most snapshots listed (the newest); each one is read and compared when the dialog opens. */
const MAX_LISTED = 50;

export interface Version extends Compared {
  entry: SnapshotEntry;
}

/** Reads the earlier versions of `file` and compares each with the current text, newest first, while `active`. */
export function useVersions(root: string | null, file: string | undefined, active: boolean) {
  const { t } = useLingui();
  const actions = useProject((s) => s.actions);
  const [versions, setVersions] = useState<Version[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!active || !root || !file) return;
    let live = true;
    setVersions([]);
    setSelected(null);
    setError("");
    setLoading(true);
    (async () => {
      await actions.flush(); // so "the current text" is what is on disk
      const current = (await readCurrentParagraphs(root, file)) ?? [];
      const list = (await bridge.listSnapshots(root, file)).slice(0, MAX_LISTED);
      if (!live) return;
      setSelected(list[0]?.path ?? null);
      for (const entry of list) {
        const read = await bridge.readSnapshot(root, file, entry.path).catch(() => null);
        if (!live) return;
        setVersions((v) => [...v, { entry, ...compareWithCurrent(current, read?.contents) }]);
      }
    })()
      .catch((e) => {
        if (live)
          setError(
            t`Could not load the earlier versions (${causeText(e)}). Close this dialog and open History again to retry.`,
          );
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [active, root, file, actions]);
  return { versions, selected, setSelected, loading, error, setError };
}
