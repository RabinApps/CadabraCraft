import { useLingui } from "@lingui/react/macro";
import type { BookSnapshotEntry } from "../../../lib/bridge";
import { SnapshotRow } from "./SnapshotRow";
import { summaryLine } from "./snapshotText";

/** The summary line over the pick list of snapshots, or a hint when there are none. */
export function SnapshotList({
  list,
  loading,
  selected,
  renaming,
  busy,
  onSelect,
  onPin,
  onStartRename,
  onCancelRename,
  onRename,
}: {
  list: BookSnapshotEntry[];
  loading: boolean;
  selected: string | null;
  /** The path of the snapshot whose name is being edited. */
  renaming: string | null;
  busy: boolean;
  onSelect: (path: string) => void;
  onPin: (entry: BookSnapshotEntry) => void;
  onStartRename: (path: string) => void;
  onCancelRename: () => void;
  onRename: (entry: BookSnapshotEntry, name: string) => Promise<void>;
}) {
  const { t, i18n } = useLingui();
  if (list.length === 0 && !loading) {
    return (
      <p className="m-0 text-sm text-ink-muted">{t`No book snapshots yet. A snapshot keeps every chapter, the chapter list and the list of images, so you can come back to the book as it is now.`}</p>
    );
  }
  return (
    <div className="flex flex-col gap-2">
      <p className="m-0 text-xs font-semibold text-ink-muted">{summaryLine(list, i18n.locale)}</p>
      <ul
        aria-label={t`Book snapshots`}
        className="m-0 flex max-h-56 list-none flex-col gap-1 overflow-y-auto p-0"
      >
        {list.map((e) => (
          <SnapshotRow
            key={e.path}
            entry={e}
            selected={e.path === selected}
            renaming={e.path === renaming}
            busy={busy}
            onSelect={() => onSelect(e.path)}
            onPin={() => onPin(e)}
            onStartRename={() => onStartRename(e.path)}
            onCancelRename={onCancelRename}
            onRename={(name) => onRename(e, name)}
          />
        ))}
      </ul>
    </div>
  );
}
