import { useCallback, useEffect, useState } from "react";
import { useLingui } from "@lingui/react/macro";
import { plural } from "@lingui/core/macro";
import { Camera, Trash2, Undo2 } from "lucide-react";
import { Button } from "../../ui/Button";
import { Confirm } from "../../ui/Dialog";
import { Field, focusField } from "../../ui/forms/Input";
import { cx } from "../../ui/cx";
import { bridge, type BookSnapshotEntry } from "../../lib/bridge";
import { causeText } from "../../lib/projectError";
import { useProject } from "../../state/project/index";
import { formatStamp } from "./formatStamp";
import type { HistoryPage } from "./HistoryDialog";

/** Longest name Rust accepts. */
const MAX_NAME = 100;

type Pending = "book" | "delete" | null;

const NAME_ID = "snapshot-name";
const ERROR_ID = "snapshot-error";

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
  const { t, i18n } = useLingui();
  const root = useProject((s) => s.root);
  const actions = useProject((s) => s.actions);
  const [list, setList] = useState<BookSnapshotEntry[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  /** What the message is about: the name field (refused), the Take button (failed) or another action. */
  const [errorAbout, setErrorAbout] = useState<"name" | "take" | "other">("other");
  const [pending, setPending] = useState<Pending>(null);

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
          setErrorAbout("other");
          setError(
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

  /** Runs one action: the buttons stay off until it settles, and a failure is shown here. */
  const run = async (
    job: () => Promise<void>,
    failure: (reason: string) => string,
    about: "take" | "other" = "other",
  ) => {
    setBusy(true);
    setError("");
    try {
      await job();
    } catch (e) {
      setErrorAbout(about);
      setError(failure(causeText(e)));
    } finally {
      setBusy(false);
    }
  };

  const take = () => {
    if (!name.trim()) {
      // The button is not dead: pressing it says what is missing and puts the cursor where it goes.
      setErrorAbout("name");
      setError(t`The snapshot has no name. Type one, for example “Before the rewrite”.`);
      focusField(NAME_ID);
      return;
    }
    void run(
      async () => {
        if (!root) return;
        await actions.flush(); // so the snapshot has what was just typed
        const made = await bridge.createBookSnapshot(root, name);
        setName("");
        await refresh(made.path);
      },
      (reason) =>
        t`Could not take the snapshot (${reason}). Your name is kept. Try again, or free some space and retry.`,
      "take",
    );
  };

  const chosen = list.find((e) => e.path === selected);
  const hasPage = !!page && !!chosen && chosen.pages.includes(page.file);
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
  const remove = () =>
    run(
      async () => {
        if (!root || !chosen) return;
        await bridge.deleteBookSnapshot(root, chosen.path);
        await refresh();
      },
      (reason) => t`Could not delete the snapshot (${reason}). It is still in the list. Try again.`,
    );

  const detail = (e: BookSnapshotEntry) =>
    `${plural(e.pages.length, { one: "# page", other: "# pages" })} · ${plural(e.assets, { one: "# image", other: "# images" })}`;

  return (
    <div className="flex flex-col gap-4">
      <form
        className="flex flex-wrap items-end gap-2.5"
        onSubmit={(ev) => {
          ev.preventDefault();
          if (!busy) take();
        }}
      >
        <div className="min-w-0 flex-1 basis-56">
          <Field
            id={NAME_ID}
            label={t`Snapshot name`}
            placeholder={t`For example, Before the rewrite`}
            maxLength={MAX_NAME}
            value={name}
            errorId={error && errorAbout === "name" ? ERROR_ID : undefined}
            onChange={(ev) => {
              setName(ev.target.value);
              if (errorAbout === "name") setError("");
            }}
          />
        </div>
        <Button
          type="submit"
          variant="primary"
          icon={Camera}
          disabled={busy}
          aria-describedby={error && errorAbout === "take" ? ERROR_ID : undefined}
        >{t`Take snapshot`}</Button>
      </form>
      {error && (
        <p id={ERROR_ID} role="alert" className="m-0 text-sm text-danger">
          {error}
        </p>
      )}
      {list.length === 0 && !loading ? (
        <p className="m-0 text-sm text-ink-muted">{t`No book snapshots yet. A snapshot keeps every chapter, the chapter list and the list of images, so you can come back to the book as it is now.`}</p>
      ) : (
        <ul
          aria-label={t`Book snapshots`}
          className="m-0 flex max-h-56 list-none flex-col gap-1 overflow-y-auto p-0"
        >
          {list.map((e) => {
            const on = e.path === selected;
            return (
              <li key={e.path}>
                <button
                  type="button"
                  aria-current={on ? "true" : undefined}
                  onClick={() => setSelected(e.path)}
                  className={cx(
                    "flex w-full flex-col gap-0.5 rounded-md px-3 py-2 text-start focus-visible:outline-2 focus-visible:outline-accent",
                    on ? "bg-accent-soft" : "hover:bg-accent-soft",
                  )}
                >
                  <span className={cx("text-sm font-semibold", on ? "text-accent" : "text-ink")}>
                    {e.name}
                    {e.automatic && (
                      <span className="ms-2 rounded-sm bg-warn-soft px-1.5 py-0.5 text-xs font-semibold text-warn">{t`Automatic`}</span>
                    )}
                  </span>
                  <span className="text-xs text-ink-muted">
                    {formatStamp(e.at, i18n.locale)} · {detail(e)}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="m-0 max-w-prose text-xs text-ink-muted">{t`Restoring the whole book first keeps the book as it is now as an automatic snapshot. Pages the snapshot does not have go to the trash, and images are never removed.`}</p>
        <div className="flex flex-wrap gap-2.5">
          <Button
            icon={Trash2}
            disabled={!chosen || busy}
            onClick={() => setPending("delete")}
          >{t`Delete snapshot`}</Button>
          {hasPage && (
            <Button
              icon={Undo2}
              disabled={busy}
              onClick={() => void restorePage()}
            >{t`Restore this page only`}</Button>
          )}
          <Button
            variant="primary"
            icon={Undo2}
            disabled={!chosen || busy}
            onClick={() => setPending("book")}
          >{t`Restore whole book`}</Button>
        </div>
      </div>
      <Confirm
        open={pending === "book"}
        onOpenChange={(o) => !o && setPending(null)}
        title={t`Restore the whole book?`}
        description={t`Every chapter and the chapter list go back to “${chosen?.name ?? ""}”. The book as it is now is kept as an automatic snapshot first.`}
        confirmLabel={t`Restore whole book`}
        onConfirm={() => void restoreBook()}
      />
      <Confirm
        open={pending === "delete"}
        onOpenChange={(o) => !o && setPending(null)}
        title={t`Delete this snapshot?`}
        description={t`“${chosen?.name ?? ""}” is removed from this computer. Your chapters are not changed.`}
        confirmLabel={t`Delete snapshot`}
        onConfirm={() => void remove()}
      />
    </div>
  );
}
