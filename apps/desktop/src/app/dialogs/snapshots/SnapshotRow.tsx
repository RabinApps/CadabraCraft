import { useEffect, useRef, useState } from "react";
import { useLingui } from "@lingui/react/macro";
import { plural } from "@lingui/core/macro";
import { Pencil, Pin, PinOff } from "lucide-react";
import { Button } from "../../../ui/Button";
import { Field } from "../../../ui/forms/Input";
import { cx } from "../../../ui/cx";
import { causeText } from "../../../lib/projectError";
import type { BookSnapshotEntry } from "../../../lib/bridge";
import { formatStamp } from "../formatStamp";
import { nameProblem } from "./snapshotText";

/** Longest name Rust accepts. */
export const MAX_NAME = 100;

const RENAME_ID = "snapshot-rename";
const RENAME_ERROR_ID = "snapshot-rename-error";

/** The badge on a row: Named (the author's own), Automatic (taken before a restore) or Pinned (never pruned for a limit). */
function Badge({ tone, children }: { tone: "named" | "auto" | "pinned"; children: string }) {
  const style = {
    named: "bg-accent-soft text-accent",
    auto: "bg-warn-soft text-warn",
    pinned: "bg-success-soft text-success",
  }[tone];
  return (
    <span className={cx("rounded-sm px-1.5 py-0.5 text-xs font-semibold", style)}>{children}</span>
  );
}

/** The inline Rename field: Enter saves, Escape cancels, a refused name is shown under the field. */
function RenameForm({
  entry,
  onSave,
  onCancel,
}: {
  entry: BookSnapshotEntry;
  onSave: (name: string) => Promise<void>;
  onCancel: () => void;
}) {
  const { t } = useLingui();
  const [draft, setDraft] = useState(entry.name);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const save = async () => {
    const problem = nameProblem(draft);
    if (problem) {
      setError(problem);
      document.getElementById(RENAME_ID)?.focus();
      return;
    }
    setSaving(true);
    setError("");
    try {
      await onSave(draft);
    } catch (e) {
      setError(t`Could not rename the snapshot (${causeText(e)}). Your name is kept. Try again.`);
      setSaving(false);
    }
  };
  return (
    <form
      data-own-escape
      className="flex flex-wrap items-end gap-2 rounded-md bg-accent-soft px-3 py-2"
      onSubmit={(ev) => {
        ev.preventDefault();
        if (!saving) void save();
      }}
    >
      <div className="min-w-0 flex-1 basis-48">
        <Field
          id={RENAME_ID}
          label={t`New name`}
          maxLength={MAX_NAME}
          value={draft}
          autoFocus
          onKeyDown={(ev) => {
            if (ev.key === "Escape") {
              ev.preventDefault();
              onCancel();
            }
          }}
          onFocus={(ev) => ev.target.select()}
          errorId={error ? RENAME_ERROR_ID : undefined}
          onChange={(ev) => {
            setDraft(ev.target.value);
            setError("");
          }}
        />
      </div>
      <Button type="submit" variant="primary" size="sm" disabled={saving}>{t`Save`}</Button>
      <Button size="sm" onClick={onCancel}>{t`Cancel`}</Button>
      {error && (
        <p id={RENAME_ERROR_ID} role="alert" className="m-0 w-full text-sm text-danger">
          {error}
        </p>
      )}
    </form>
  );
}

/** One snapshot in the list: pick it, pin it, rename it. */
export function SnapshotRow({
  entry,
  selected,
  renaming,
  busy,
  onSelect,
  onPin,
  onStartRename,
  onCancelRename,
  onRename,
}: {
  entry: BookSnapshotEntry;
  selected: boolean;
  renaming: boolean;
  busy: boolean;
  onSelect: () => void;
  onPin: () => void;
  onStartRename: () => void;
  onCancelRename: () => void;
  onRename: (name: string) => Promise<void>;
}) {
  const { t, i18n } = useLingui();
  const item = useRef<HTMLLIElement>(null);
  const wasRenaming = useRef(false);
  useEffect(() => {
    // Focus goes back to the button that opened the field once it saves or is cancelled.
    if (wasRenaming.current && !renaming)
      item.current?.querySelector<HTMLElement>("[data-rename]")?.focus();
    wasRenaming.current = renaming;
  }, [renaming]);
  if (renaming) {
    return (
      <li ref={item}>
        <RenameForm entry={entry} onSave={onRename} onCancel={onCancelRename} />
      </li>
    );
  }
  const detail = `${plural(entry.pages.length, { one: "# page", other: "# pages" })} · ${plural(entry.assets, { one: "# image", other: "# images" })}`;
  return (
    <li ref={item} className="flex flex-wrap items-center gap-1">
      <button
        type="button"
        aria-current={selected ? "true" : undefined}
        onClick={onSelect}
        className={cx(
          "flex min-w-0 flex-1 basis-48 flex-col gap-0.5 rounded-md px-3 py-2 text-start focus-visible:outline-2 focus-visible:outline-accent",
          selected ? "bg-accent-soft" : "hover:bg-accent-soft",
        )}
      >
        <span
          className={cx(
            "flex flex-wrap items-center gap-x-2 gap-y-1 text-sm font-semibold",
            selected ? "text-accent" : "text-ink",
          )}
        >
          <span className="min-w-0 break-words">{entry.name}</span>
          {entry.automatic ? (
            <Badge tone="auto">{t`Automatic`}</Badge>
          ) : (
            <Badge tone="named">{t`Named`}</Badge>
          )}
          {entry.pinned && <Badge tone="pinned">{t`Pinned`}</Badge>}
        </span>
        <span className="text-xs text-ink-muted">
          {formatStamp(entry.at, i18n.locale)} · {detail}
        </span>
      </button>
      <Button
        size="sm"
        variant="ghost"
        icon={entry.pinned ? PinOff : Pin}
        aria-pressed={entry.pinned}
        aria-label={t`Pin ${entry.name}`}
        disabled={busy}
        onClick={onPin}
      >{t`Pin`}</Button>
      <Button
        data-rename
        size="sm"
        variant="ghost"
        icon={Pencil}
        aria-label={t`Rename ${entry.name}`}
        disabled={busy}
        onClick={onStartRename}
      >{t`Rename`}</Button>
    </li>
  );
}
