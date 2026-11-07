import { useState } from "react";
import { useLingui } from "@lingui/react/macro";
import { focusField } from "../../ui/forms/Input";
import { bridge, type BookSnapshotEntry } from "../../lib/bridge";
import { useProject } from "../../state/project/index";
import { useSettings } from "../../state/view/editorPrefs";
import type { HistoryPage } from "./HistoryDialog";
import { BookCompare } from "./snapshots/BookCompare";
import {
  NAME_ID,
  SnapshotActions,
  SnapshotConfirms,
  SnapshotNameForm,
  type Pending,
} from "./snapshots/SnapshotControls";
import { SnapshotList } from "./snapshots/SnapshotList";
import { limitsOf, nameProblem, pruneNotice, type PruneNotice } from "./snapshots/snapshotText";
import { useRestoreJobs } from "./snapshots/useRestoreJobs";
import { useSnapshotJobs } from "./snapshots/useSnapshotJobs";
import { useBookCompare } from "./snapshots/useBookCompare";
import { useSnapshotList } from "./snapshots/useSnapshotList";

/** What keeping to the limits moved to the trash: an ordinary notice, and a warning when pinned snapshots moved too. */
function PruneNotices({ notice }: { notice: PruneNotice | null }) {
  if (!notice) return null;
  return (
    <div className="flex flex-col gap-1.5">
      {notice.older && (
        <p role="status" className="m-0 rounded-md bg-accent-soft px-3 py-2 text-sm text-ink">
          {notice.older}
        </p>
      )}
      {notice.pinned && (
        <p
          role="alert"
          className="m-0 rounded-md bg-warn-soft px-3 py-2 text-sm font-semibold text-warn"
        >
          {notice.pinned}
        </p>
      )}
    </div>
  );
}

/**
 * Snapshots of the whole book: take a named one, restore the whole book (or just the page History was opened from) or delete one.
 * Restoring the book first keeps the book as it is as an automatic snapshot, listed here too.
 */
export function BookSnapshotsPanel({
  page,
  onDone,
}: {
  page: HistoryPage | null;
  /** The book or page was restored: close the dialog. */
  onDone: () => void;
}) {
  const { t } = useLingui();
  const root = useProject((s) => s.root);
  const actions = useProject((s) => s.actions);
  const [name, setName] = useState("");
  const [pending, setPending] = useState<Pending>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const { busy, error, errorAbout, notice, setNotice, setError, fail, run } = useSnapshotJobs();
  const { list, selected, setSelected, loading, refresh } = useSnapshotList(root, (message) =>
    fail("other", message),
  );

  const take = () => {
    const problem = nameProblem(name);
    if (problem) {
      // The button is not dead: pressing it says what is missing and puts the cursor where it goes.
      fail("name", problem);
      focusField(NAME_ID);
      return;
    }
    void run(
      async () => {
        if (!root) return;
        await actions.flush(); // so the snapshot has what was just typed
        const made = await bridge.createBookSnapshot(root, name, limitsOf(useSettings.getState()));
        setName("");
        setNotice(pruneNotice(made.pruned));
        await refresh(made.path);
      },
      (reason) =>
        t`Could not take the snapshot (${reason}). Your name is kept. Try again, or free some space and retry.`,
      "take",
    );
  };

  const chosen = list.find((e) => e.path === selected);
  const compare = useBookCompare(root, page ? chosen : undefined, page?.file);
  const hasPage = !!page && !!chosen && chosen.pages.includes(page.file);
  const { restoreBook, restorePage } = useRestoreJobs(run, chosen, page, onDone);
  /** Changes the snapshot files, then reads the list again. */
  const edit = (change: (root: string) => Promise<unknown>, failure: (reason: string) => string) =>
    run(async () => {
      if (!root) return;
      await change(root);
      await refresh();
    }, failure);
  const pin = (e: BookSnapshotEntry) =>
    edit(
      (r) => bridge.pinBookSnapshot(r, e.path, !e.pinned),
      (reason) => t`Could not change the pin (${reason}). Try again.`,
    );
  /** Throws a failure so the row can show it next to its field. */
  const rename = async (e: BookSnapshotEntry, newName: string) => {
    if (!root) return;
    await bridge.renameBookSnapshot(root, e.path, newName);
    await refresh();
    setRenaming(null);
  };
  const remove = () =>
    edit(
      async (r) => chosen && bridge.deleteBookSnapshot(r, chosen.path),
      (reason) => t`Could not delete the snapshot (${reason}). It is still in the list. Try again.`,
    );

  return (
    <div className="flex flex-col gap-4">
      <SnapshotNameForm
        name={name}
        busy={busy}
        error={error}
        errorAbout={errorAbout}
        onName={(value) => {
          setName(value);
          if (errorAbout === "name") setError("");
        }}
        onTake={take}
      />
      <PruneNotices notice={notice} />
      <SnapshotList
        list={list}
        loading={loading}
        selected={selected}
        renaming={renaming}
        busy={busy}
        onSelect={setSelected}
        onPin={(e) => void pin(e)}
        onStartRename={setRenaming}
        onCancelRename={() => setRenaming(null)}
        onRename={rename}
      />
      {page && <BookCompare state={compare} title={page.title} />}
      <SnapshotActions
        hasChosen={!!chosen}
        hasPage={hasPage}
        busy={busy}
        onDelete={() => setPending("delete")}
        onRestorePage={() => void restorePage()}
        onRestoreBook={() => setPending("book")}
      />
      <SnapshotConfirms
        pending={pending}
        chosen={chosen}
        onClose={() => setPending(null)}
        onRestoreBook={() => void restoreBook()}
        onDelete={() => void remove()}
      />
    </div>
  );
}
