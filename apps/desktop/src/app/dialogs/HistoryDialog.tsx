import { useEffect, useState } from "react";
import { useLingui } from "@lingui/react/macro";
import { plural } from "@lingui/core/macro";
import { Undo2 } from "lucide-react";
import { isChapterDoc } from "@cadabracraft/editor-schema";
import { countWords, type ChapterDoc } from "@cadabracraft/shared";
import { Modal } from "../../ui/Dialog";
import { Button } from "../../ui/Button";
import { Segmented } from "../../ui/Segmented";
import { cx } from "../../ui/cx";
import { BookSnapshotsPanel } from "./BookSnapshotsPanel";
import { formatStamp } from "./formatStamp";
import { bridge, type SnapshotEntry } from "../../lib/bridge";
import { causeText } from "../../lib/projectError";
import { changeSummary, diffChapters, paragraphsOf, type DiffLine } from "../../lib/wordDiff";
import { useProject } from "../../state/project/index";

/** Most snapshots listed (the newest); each one is read and compared when the dialog opens. */
const MAX_LISTED = 50;

export interface HistoryPage {
  id: string;
  title: string;
  file: string;
}

interface Version {
  entry: SnapshotEntry;
  /** Null when the snapshot file could not be read or is not a valid chapter. */
  words: number | null;
  lines: DiffLine[];
  added: number;
  removed: number;
}

function parseDoc(contents: string | undefined): ChapterDoc | null {
  if (contents === undefined) return null;
  try {
    const raw: unknown = JSON.parse(contents);
    return isChapterDoc(raw) ? raw : null;
  } catch {
    return null;
  }
}

type View = "page" | "book";

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
  const { t, i18n } = useLingui();
  const root = useProject((s) => s.root);
  const actions = useProject((s) => s.actions);
  const [versions, setVersions] = useState<Version[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const [choice, setChoice] = useState<View | null>(null);
  useEffect(() => {
    if (!open) setChoice(null); // each time the dialog opens it starts on the view it was asked for
  }, [open]);
  const view: View = page ? (choice ?? initialView) : "book";

  const file = page?.file;
  useEffect(() => {
    if (!open || !root || !file || view !== "page") return;
    let live = true;
    setVersions([]);
    setSelected(null);
    setError("");
    setLoading(true);
    (async () => {
      await actions.flush(); // so "the current text" is what is on disk
      const now = await bridge.readFile(root, file);
      const current = paragraphsOf(parseDoc(now?.contents));
      const list = (await bridge.listSnapshots(root, file)).slice(0, MAX_LISTED);
      if (!live) return;
      setSelected(list[0]?.path ?? null);
      for (const entry of list) {
        const read = await bridge.readSnapshot(root, file, entry.path).catch(() => null);
        if (!live) return;
        const doc = parseDoc(read?.contents);
        const lines = doc ? diffChapters(current, paragraphsOf(doc)) : [];
        const { added, removed } = changeSummary(lines);
        setVersions((v) => [
          ...v,
          { entry, words: doc ? countWords(doc) : null, lines, added, removed },
        ]);
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
  }, [open, root, file, view, actions]);

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
  const detail = (v: Version) => {
    if (v.words === null) return t`Could not be read`;
    const words = plural(v.words, { one: "# word", other: "# words" });
    return v.added || v.removed
      ? `${words} · +${v.added} −${v.removed}`
      : `${words} · ${t`same as now`}`;
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
                        onClick={() => setSelected(v.entry.path)}
                        className={cx(
                          "flex w-full flex-col gap-0.5 rounded-md px-3 py-2 text-start focus-visible:outline-2 focus-visible:outline-accent",
                          on ? "bg-accent-soft" : "hover:bg-accent-soft",
                        )}
                      >
                        <span
                          className={cx("text-sm font-semibold", on ? "text-accent" : "text-ink")}
                        >
                          {formatStamp(v.entry.at, i18n.locale)}
                        </span>
                        <span className="text-xs text-ink-muted">{detail(v)}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
              <div className="flex min-w-0 flex-1 flex-col gap-2.5">
                <div className="flex flex-wrap items-center gap-2.5 text-xs">
                  <span className="text-ink-muted">{t`Compared with the current text`}</span>
                  <ins className="rounded-sm bg-success-soft px-2 py-0.5 font-semibold text-success underline">{t`In this version only`}</ins>
                  <del className="rounded-sm bg-danger-soft px-2 py-0.5 font-semibold text-danger line-through">{t`Only in the current text`}</del>
                </div>
                <div
                  aria-label={t`Comparison`}
                  className="flex max-h-[340px] min-h-40 flex-col gap-3 overflow-y-auto rounded-md border border-border bg-paper p-5 font-book text-base text-ink md:max-h-[360px]"
                >
                  {chosen &&
                    chosen.words !== null &&
                    chosen.added === 0 &&
                    chosen.removed === 0 && (
                      <p className="font-ui text-sm text-ink-muted">{t`This version has the same words as the current text.`}</p>
                    )}
                  {chosen?.lines.map((line, i) => (
                    <p key={i} className="m-0">
                      {line.map((part, j) => (
                        <span key={j}>
                          {j > 0 && " "}
                          {part.kind === "add" ? (
                            <ins className="rounded-sm bg-success-soft px-0.5 text-success underline">
                              <span className="sr-only">{t`Inserted:`} </span>
                              {part.text}
                            </ins>
                          ) : part.kind === "del" ? (
                            <del className="rounded-sm bg-danger-soft px-0.5 text-danger line-through">
                              <span className="sr-only">{t`Deleted:`} </span>
                              {part.text}
                            </del>
                          ) : (
                            part.text
                          )}
                        </span>
                      ))}
                    </p>
                  ))}
                </div>
              </div>
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
