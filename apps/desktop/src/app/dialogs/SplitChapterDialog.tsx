import { useEffect, useId, useState } from "react";
import { useLingui } from "@lingui/react/macro";
import { Scissors } from "lucide-react";
import { Modal } from "../../ui/Dialog";
import { Button } from "../../ui/Button";
import { Field } from "../../ui/forms/Input";
import { Notice } from "../../ui/feedback/Notice";
import { bridge } from "../../lib/bridge";
import { causeText } from "../../lib/projectError";
import { splitPoints, type SplitPoint } from "../../lib/split/splitPoints";
import { useProject } from "../../state/project/index";
import { parseChapter } from "../../state/project/util";

/** The chapter to split: its id, title and source-language file. */
export interface SplitPage {
  id: string;
  title: string;
  file: string;
}

type Reading =
  | { state: "loading" }
  | { state: "ready"; points: SplitPoint[] }
  | { state: "failed"; message: string };

/** Reads the chapter from disk (after unsaved typing is written) and lists the headings it can be cut at. */
function useSplitPoints(page: SplitPage | null): Reading {
  const root = useProject((s) => s.root);
  const flush = useProject((s) => s.actions.flush);
  const [reading, setReading] = useState<Reading>({ state: "loading" });
  const file = page?.file;
  useEffect(() => {
    if (!file || !root) return;
    let live = true;
    setReading({ state: "loading" });
    flush()
      .then(() => bridge.readFile(root, file))
      .then((r) => {
        if (!live) return;
        if (!r) throw new Error(file);
        setReading({ state: "ready", points: splitPoints(parseChapter(r.contents, file)) });
      })
      .catch((e) => live && setReading({ state: "failed", message: causeText(e) }));
    return () => {
      live = false;
    };
  }, [file, root, flush]);
  return reading;
}

/** Why the dialog cannot offer a split (translations, an unreadable chapter, no heading), or "" when it can. */
function useSplitNote(translated: boolean, reading: Reading): string {
  const { t } = useLingui();
  if (translated)
    return t`This book has translations, and a split would no longer line up with them. Splitting a chapter is not available in a book with translations yet.`;
  if (reading.state === "failed")
    return t`Could not read this chapter (${reading.message}). Nothing was changed.`;
  if (reading.state === "ready" && reading.points.length === 0)
    return t`This chapter has no heading to split at. Add a heading where the new chapter should start, then try again.`;
  return "";
}

/** The choice of heading, the new chapter's title and the buttons. */
function SplitForm({
  points,
  loading,
  chosen,
  title,
  error,
  busy,
  onChoose,
  onTitle,
  onSubmit,
  onCancel,
}: {
  points: SplitPoint[];
  loading: boolean;
  chosen: number | undefined;
  title: string;
  error: string;
  busy: boolean;
  onChoose: (block: number) => void;
  onTitle: (title: string) => void;
  onSubmit: () => void;
  onCancel: () => void;
}) {
  const { t } = useLingui();
  const name = useId();
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit();
      }}
    >
      <fieldset className="flex min-w-0 flex-col gap-1.5" disabled={busy}>
        <legend className="mb-1.5 text-xs font-semibold text-ink-muted">
          {t`Start the new chapter at`}
        </legend>
        <div className="flex max-h-60 flex-col gap-0.5 overflow-y-auto rounded-md border border-border bg-surface p-1.5">
          {loading && (
            <p role="status" className="px-2 py-1 text-sm text-ink-muted">{t`Reading…`}</p>
          )}
          {points.map((p) => (
            <label
              key={p.block}
              className="flex min-h-9 cursor-pointer items-center gap-2.5 rounded-sm px-2 text-sm hover:bg-accent-soft max-md:min-h-11"
              style={{ paddingInlineStart: `${0.5 + (p.level - 1) * 0.875}rem` }}
            >
              <input
                type="radio"
                name={name}
                checked={chosen === p.block}
                onChange={() => onChoose(p.block)}
                className="size-4 shrink-0 accent-accent"
              />
              <span className="min-w-0 break-words">{p.text}</span>
            </label>
          ))}
        </div>
      </fieldset>
      <Field
        label={t`Title of the new chapter`}
        value={title}
        disabled={busy || chosen === undefined}
        onChange={(e) => onTitle(e.target.value)}
        hint={t`Left as it is, the new chapter is named after its heading.`}
      />
      {error && (
        <Notice role="alert" className="max-h-40 overflow-y-auto wrap-break-word">
          {error}
        </Notice>
      )}
      <div className="flex justify-end gap-2.5">
        <Button onClick={onCancel} disabled={busy}>{t`Cancel`}</Button>
        <Button
          type="submit"
          variant="primary"
          icon={Scissors}
          disabled={busy || chosen === undefined}
        >
          {busy ? t`Splitting…` : t`Split chapter`}
        </Button>
      </div>
    </form>
  );
}

/**
 * Split a chapter of the open book at one of its headings: the text before the heading stays, the heading and everything
 * after it become a new chapter right behind it. One undo step.
 */
export function SplitChapterDialog({
  page,
  onClose,
  onNavigate,
}: {
  page: SplitPage | null;
  onClose: () => void;
  onNavigate?: () => void;
}) {
  const { t } = useLingui();
  const actions = useProject((s) => s.actions);
  const translated = useProject((s) => (s.manifest?.editions.length ?? 1) > 1);
  const reading = useSplitPoints(page);
  const [block, setBlock] = useState<number | null>(null);
  /** The title the author typed; null while the new chapter is still named after its heading. */
  const [typed, setTyped] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const points = reading.state === "ready" ? reading.points : [];
  useEffect(() => {
    setBlock(null);
    setTyped(null);
    setError("");
  }, [page?.id]);
  const chosen = points.find((p) => p.block === (block ?? points[0]?.block));
  const title = typed ?? chosen?.text ?? "";
  const note = useSplitNote(translated, reading);
  const close = () => {
    if (!busy) onClose();
  };
  const submit = () => {
    if (!page || !chosen || busy) return;
    setBusy(true);
    setError("");
    actions
      .splitChapter(page.id, chosen.block, title)
      .then(() => {
        setBusy(false);
        onClose();
        onNavigate?.();
      })
      .catch((e) => {
        setBusy(false);
        setError(t`Could not split the chapter (${causeText(e)}). Nothing was changed.`);
      });
  };
  return (
    <Modal
      open={page !== null}
      onOpenChange={(o) => !o && close()}
      title={t`Split “${page?.title ?? ""}”`}
      description={t`The text before the heading you pick stays in this chapter. The heading and everything after it become a new chapter right after it. Undo puts it back.`}
    >
      {note ? (
        <div className="flex flex-col gap-4">
          <Notice tone="warn" role="alert">
            {note}
          </Notice>
          <div className="flex justify-end">
            <Button onClick={close}>{t`Close`}</Button>
          </div>
        </div>
      ) : (
        <SplitForm
          points={points}
          loading={reading.state === "loading"}
          chosen={chosen?.block}
          title={title}
          error={error}
          busy={busy}
          onChoose={(b) => {
            setBlock(b);
            setTyped(null);
          }}
          onTitle={setTyped}
          onSubmit={submit}
          onCancel={close}
        />
      )}
    </Modal>
  );
}
