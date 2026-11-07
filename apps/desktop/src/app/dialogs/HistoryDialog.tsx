import { useEffect, useState } from "react";
import { useLingui } from "@lingui/react/macro";
import { plural } from "@lingui/core/macro";
import { Undo2 } from "lucide-react";
import { Modal } from "../../ui/Dialog";
import { Button } from "../../ui/Button";
import { Segmented } from "../../ui/forms/Segmented";
import { cx } from "../../ui/cx";
import { BookSnapshotsPanel } from "./BookSnapshotsPanel";
import { Comparison } from "./snapshots/Comparison";
import { useVersions, type Version } from "./snapshots/useVersions";
import { formatStamp } from "./formatStamp";
import { causeText } from "../../lib/projectError";
import { useProject } from "../../state/project/index";

export interface HistoryPage {
  id: string;
  title: string;
  file: string;
}

type View = "page" | "book";

/** The pick list of earlier versions. */
function VersionList({
  versions,
  selected,
  onSelect,
}: {
  versions: Version[];
  selected: string | null;
  onSelect: (path: string) => void;
}) {
  const { t, i18n } = useLingui();
  const detail = (v: Version) => {
    if (v.words === null) return t`Could not be read`;
    const words = plural(v.words, { one: "# word", other: "# words" });
    return v.added || v.removed
      ? `${words} · +${v.added} −${v.removed}`
      : `${words} · ${t`same as now`}`;
  };
  return (
    <ul
      aria-label={t`Earlier versions`}
      className="m-0 flex max-h-40 list-none flex-col gap-1 overflow-y-auto p-0 md:max-h-[400px] md:w-[230px] md:shrink-0"
    >
      {versions.map((v) => {
        const on = v.entry.path === selected;
        return (
          <li key={v.entry.path}>
            <button
              type="button"
              aria-current={on ? "true" : undefined}
              onClick={() => onSelect(v.entry.path)}
              className={cx(
                "flex w-full flex-col gap-0.5 rounded-md px-3 py-2 text-start focus-visible:outline-2 focus-visible:outline-accent",
                on ? "bg-accent-soft" : "hover:bg-accent-soft",
              )}
            >
              <span className={cx("text-sm font-semibold", on ? "text-accent" : "text-ink")}>
                {formatStamp(v.entry.at, i18n.locale)}
              </span>
              <span className="text-xs text-ink-muted">{detail(v)}</span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * Earlier versions of a page, compared with the current text (restoring keeps the current text as a snapshot, so it can be
 * undone), and snapshots of the whole book. Without a `page` only the book snapshots are shown.
 */
export function HistoryDialog({
  page,
  open,
  onOpenChange,
  onNavigate,
  initialView = "page",
}: {
  page: HistoryPage | null;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onNavigate?: () => void;
  initialView?: View;
}) {
  const { t } = useLingui();
  const root = useProject((s) => s.root);
  const actions = useProject((s) => s.actions);
  const [choice, setChoice] = useState<View | null>(null);
  useEffect(() => {
    if (!open) setChoice(null); // each time the dialog opens it starts on the view it was asked for
  }, [open]);
  const view: View = page ? (choice ?? initialView) : "book";
  const { versions, selected, setSelected, loading, error, setError } = useVersions(
    root,
    page?.file,
    open && view === "page",
  );

  const chosen = versions.find((v) => v.entry.path === selected);
  const restore = () => {
    if (!page || !chosen) return;
    setError("");
    void actions.restoreSnapshot(page.id, chosen.entry.path).then(
      () => {
        onOpenChange(false);
        onNavigate?.();
      },
      (e) =>
        setError(
          t`Could not restore this version (${causeText(e)}). Your current text was not changed. Try again, or pick another version.`,
        ),
    );
  };

  return (
    <Modal
      size="xl"
      open={open}
      onOpenChange={onOpenChange}
      title={page ? t`History · ${page.title}` : t`History · Whole book`}
      description={
        view === "book"
          ? t`Snapshots of the whole book. Take one before a big change; restore it to bring every chapter back.`
          : t`Earlier versions of this page. Pick one to compare it with the current text.`
      }
    >
      {page && (
        <div className="mb-4">
          <Segmented<View>
            label={t`History of`}
            value={view}
            onChange={setChoice}
            items={[
              { value: "page", label: t`This page` },
              { value: "book", label: t`Whole book` },
            ]}
          />
        </div>
      )}
      {view === "book" ? (
        <>
          <BookSnapshotsPanel
            page={page}
            onDone={() => {
              onOpenChange(false);
              onNavigate?.();
            }}
          />
          <div className="mt-5 flex justify-end">
            <Button onClick={() => onOpenChange(false)}>{t`Close`}</Button>
          </div>
        </>
      ) : (
        <>
          {error && (
            <p id="history-error" role="alert" className="mb-3 text-sm text-danger">
              {error}
            </p>
          )}
          {versions.length === 0 && !loading && !error ? (
            <p className="text-sm text-ink-muted">{t`No earlier versions yet. One is kept each time you save over different text, at most every 10 minutes.`}</p>
          ) : (
            <div className="flex flex-col gap-5 md:flex-row">
              <VersionList versions={versions} selected={selected} onSelect={setSelected} />
              <Comparison chosen={chosen} label={t`Comparison`} />
            </div>
          )}
          <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
            <p className="m-0 text-xs text-ink-muted">{t`Restoring keeps the current text as a new snapshot, so you can undo it.`}</p>
            <div className="flex gap-2.5">
              <Button onClick={() => onOpenChange(false)}>{t`Close`}</Button>
              <Button
                variant="primary"
                icon={Undo2}
                disabled={!chosen || chosen.words === null}
                aria-describedby={error ? "history-error" : undefined}
                onClick={restore}
              >{t`Restore this version`}</Button>
            </div>
          </div>
        </>
      )}
    </Modal>
  );
}
