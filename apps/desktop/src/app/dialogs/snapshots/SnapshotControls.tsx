import { useLingui } from "@lingui/react/macro";
import { Camera, Trash2, Undo2 } from "lucide-react";
import { Button } from "../../../ui/Button";
import { Confirm } from "../../../ui/Dialog";
import { Field } from "../../../ui/forms/Input";
import type { BookSnapshotEntry } from "../../../lib/bridge";
import { MAX_NAME } from "./SnapshotRow";

export type Pending = "book" | "delete" | null;
export type ErrorAbout = "name" | "take" | "other";

export const NAME_ID = "snapshot-name";
export const ERROR_ID = "snapshot-error";

/** The name field and the "Take snapshot" button. */
export function SnapshotNameForm({
  name,
  busy,
  error,
  errorAbout,
  onName,
  onTake,
}: {
  name: string;
  busy: boolean;
  error: string;
  errorAbout: ErrorAbout;
  onName: (name: string) => void;
  onTake: () => void;
}) {
  const { t } = useLingui();
  return (
    <>
      <form
        className="flex flex-wrap items-end gap-2.5"
        onSubmit={(ev) => {
          ev.preventDefault();
          if (!busy) onTake();
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
            onChange={(ev) => onName(ev.target.value)}
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
    </>
  );
}

/** The delete / restore buttons under the list. */
export function SnapshotActions({
  hasChosen,
  hasPage,
  busy,
  onDelete,
  onRestorePage,
  onRestoreBook,
}: {
  hasChosen: boolean;
  hasPage: boolean;
  busy: boolean;
  onDelete: () => void;
  onRestorePage: () => void;
  onRestoreBook: () => void;
}) {
  const { t } = useLingui();
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <p className="m-0 max-w-prose text-xs text-ink-muted">{t`Restoring the whole book first keeps the book as it is now as an automatic snapshot. Pages the snapshot does not have go to the trash, and images are never removed.`}</p>
      <div className="flex flex-wrap gap-2.5">
        <Button
          icon={Trash2}
          disabled={!hasChosen || busy}
          onClick={onDelete}
        >{t`Delete snapshot`}</Button>
        {hasPage && (
          <Button
            icon={Undo2}
            disabled={busy}
            onClick={onRestorePage}
          >{t`Restore this page only`}</Button>
        )}
        <Button
          variant="primary"
          icon={Undo2}
          disabled={!hasChosen || busy}
          onClick={onRestoreBook}
        >{t`Restore whole book`}</Button>
      </div>
    </div>
  );
}

/** The two confirmations: restore the whole book, delete a snapshot. */
export function SnapshotConfirms({
  pending,
  chosen,
  onClose,
  onRestoreBook,
  onDelete,
}: {
  pending: Pending;
  chosen: BookSnapshotEntry | undefined;
  onClose: () => void;
  onRestoreBook: () => void;
  onDelete: () => void;
}) {
  const { t } = useLingui();
  return (
    <>
      <Confirm
        open={pending === "book"}
        onOpenChange={(o) => !o && onClose()}
        title={t`Restore the whole book?`}
        description={t`Every chapter and the chapter list go back to “${chosen?.name ?? ""}”. The book as it is now is kept as an automatic snapshot first.`}
        confirmLabel={t`Restore whole book`}
        onConfirm={onRestoreBook}
      />
      <Confirm
        open={pending === "delete"}
        onOpenChange={(o) => !o && onClose()}
        title={t`Delete this snapshot?`}
        description={t`“${chosen?.name ?? ""}” is removed from this computer. Your chapters are not changed.`}
        confirmLabel={t`Delete snapshot`}
        onConfirm={onDelete}
      />
    </>
  );
}
