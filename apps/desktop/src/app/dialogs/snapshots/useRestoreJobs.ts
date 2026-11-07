import { useLingui } from "@lingui/react/macro";
import type { BookSnapshotEntry } from "../../../lib/bridge";
import { useProject } from "../../../state/project/index";
import type { useSnapshotJobs } from "./useSnapshotJobs";

/** Restoring the chosen snapshot: the whole book, or only the chapter History was opened from. `onDone` closes the dialog. */
export function useRestoreJobs(
  run: ReturnType<typeof useSnapshotJobs>["run"],
  chosen: BookSnapshotEntry | undefined,
  page: { id: string } | null,
  onDone: () => void,
) {
  const { t } = useLingui();
  const actions = useProject((s) => s.actions);
  const restoreBook = () =>
    run(
      async () => {
        if (!chosen) return;
        await actions.restoreBook(chosen.path);
        onDone();
      },
      (reason) => t`Could not restore the book (${reason}). Try again, or pick another snapshot.`,
    );
  const restorePage = () =>
    run(
      async () => {
        if (!chosen || !page) return;
        await actions.restorePageFromBook(page.id, chosen.path);
        onDone();
      },
      (reason) =>
        t`Could not restore this page (${reason}). Your current text was not changed. Try again, or pick another snapshot.`,
    );
  return { restoreBook, restorePage };
}
