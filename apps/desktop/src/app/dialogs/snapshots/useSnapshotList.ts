import { useCallback, useEffect, useState } from "react";
import { useLingui } from "@lingui/react/macro";
import { bridge, type BookSnapshotEntry } from "../../../lib/bridge";
import { causeText } from "../../../lib/projectError";

/** The snapshots of the book, with the selected one; `onError` hears about a failed read. */
export function useSnapshotList(root: string | null, onError: (message: string) => void) {
  const { t } = useLingui();
  const [list, setList] = useState<BookSnapshotEntry[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const refresh = useCallback(
    async (pick?: string) => {
      if (!root) return;
      const next = await bridge.listBookSnapshots(root);
      setList(next);
      setSelected(
        (cur) => pick ?? (next.some((e) => e.path === cur) ? cur : (next[0]?.path ?? null)),
      );
    },
    [root],
  );
  useEffect(() => {
    let live = true;
    setLoading(true);
    refresh()
      .catch((e) => {
        if (live) {
          onError(
            t`Could not read the book snapshots (${causeText(e)}). Close this dialog and open History again to retry.`,
          );
        }
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [refresh]);
  return { list, selected, setSelected, loading, refresh };
}
