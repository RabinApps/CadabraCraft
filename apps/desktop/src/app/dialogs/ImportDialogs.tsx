import { useCallback, useRef, useState } from "react";
import { useLingui } from "@lingui/react/macro";
import { ArrowLeft, ArrowRight, FileUp, FolderOpen } from "lucide-react";
import type { ImportResult } from "@cadabracraft/import-docx";
import { Segmented } from "../../ui/Segmented";
import { Button } from "../../ui/Button";
import { Modal } from "../../ui/Dialog";
import { Field } from "../../ui/Input";
import {
  loadImport,
  parseImport,
  titleFromFile,
  type ImportChoices,
  type LoadedSource,
} from "../../lib/importBook";
import { baseName } from "../../lib/paths";
import { errText } from "../../lib/projectError";
import { initialPlan, keptCount, type ImportPlan } from "../../lib/importPlan";
import { ImportChapterList } from "./ImportChapterList";
import { PickRow, Summary } from "./ImportParts";
import { Notice } from "../../ui/Notice";

export { ImportReportDialog } from "./ImportReportDialog";

interface ImportProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  pickSource: () => Promise<string | null>;
  pickFolder: () => Promise<string | null>;
  onImport: (
    source: string,
    root: string,
    title: string,
    author: string,
    opts?: ImportChoices,
  ) => Promise<void>;
  /** When set, the dialog adds the chosen chapters to the open book instead of creating one: no title, author or folder. */
  onImportInto?: (source: string, opts?: ImportChoices) => Promise<void>;
}

type Level = 1 | 2 | 3;
interface Preview {
  loaded: LoadedSource;
  level: Level;
  result: ImportResult;
  plan: ImportPlan;
}

/** Two steps: pick a source and destination, then preview how it splits into chapters. Only the last button writes; the source is only read. */
export function ImportDialog({
  open,
  onOpenChange,
  pickSource,
  pickFolder,
  onImport,
  onImportInto,
}: ImportProps) {
  const append = onImportInto !== undefined;
  const { t } = useLingui();
  const [source, setSource] = useState<string | null>(null);
  const [root, setRoot] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [author, setAuthor] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const ready = source !== null && (append || (root !== null && title.trim() !== "")) && !busy;
  const kept = preview ? keptCount(preview.plan) : 0;
  // Bumped whenever the dialog closes or the source changes: an answer that arrives for an older state is dropped.
  const gen = useRef(0);
  const change = (o: boolean) => {
    if (busy) return;
    if (!o) {
      gen.current++;
      setSource(null);
      setRoot(null);
      setTitle("");
      setAuthor("");
      setPreview(null);
      setError("");
    }
    onOpenChange(o);
  };
  const pick = (f: () => Promise<string | null>, then: (p: string) => void) => {
    if (busy) return;
    setError("");
    const mine = gen.current;
    // A cancelled picker answers null; a picker that answers after the dialog was closed is ignored.
    f()
      .then((p) => {
        if (p && mine === gen.current) then(p);
      })
      .catch((e) => {
        if (mine === gen.current) setError(errText(e));
      });
  };
  const parse = async (loaded: LoadedSource, level: Level) => {
    const result = await parseImport(loaded, level);
    setPreview({ loaded, level, result, plan: initialPlan(result) });
  };
  const next = () => {
    if (!source || busy) return;
    setBusy(true);
    setError("");
    loadImport(source)
      .then((l) => parse(l, 1))
      .catch((e) => setError(errText(e)))
      .finally(() => setBusy(false));
  };
  // A Word document is parsed again in Rust, which can take a moment on a large manuscript: the buttons wait for it.
  const setLevel = (level: Level) => {
    if (!preview || busy) return;
    setBusy(true);
    setError("");
    parse(preview.loaded, level)
      .catch((e) => setError(errText(e)))
      .finally(() => setBusy(false));
  };
  const setPlan = useCallback((plan: ImportPlan) => setPreview((p) => p && { ...p, plan }), []);
  const submit = () => {
    if (!source || busy || (!append && !root)) return;
    setBusy(true);
    setError("");
    const choices = preview ? { splitHeadingLevel: preview.level, plan: preview.plan } : undefined;
    (onImportInto
      ? onImportInto(source, choices)
      : onImport(source, root!, title.trim(), author.trim() || t`Unknown`, choices)
    )
      .then(() => {
        setBusy(false);
        change(false);
      })
      .catch((err) => {
        setBusy(false);
        setError(errText(err));
      });
  };
  const errorBox = error && (
    <Notice role="alert" className="max-h-40 overflow-y-auto break-words">
      {error}
    </Notice>
  );
  return (
    <Modal
      open={open}
      onOpenChange={change}
      title={append ? t`Import into this book` : t`Import a manuscript`}
      description={
        append
          ? t`Adds the chapters of a Word (.docx), Markdown or HTML file after the last chapter of this book. Existing chapters are not changed, and neither is the original file.`
          : t`Creates a new book from a Word (.docx), Markdown or HTML file. The original file is never changed.`
      }
    >
      {!preview ? (
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (ready) next();
          }}
        >
          <PickRow
            label={t`File`}
            value={source ? baseName(source) : ""}
            placeholder={t`No file chosen`}
            button={t`Choose file…`}
            icon={FileUp}
            disabled={busy}
            onPick={() =>
              pick(pickSource, (p) => {
                setSource(p);
                setTitle((cur) => cur || titleFromFile(p));
              })
            }
          />
          {!append && (
            <>
              <Field label={t`Title`} value={title} onChange={(e) => setTitle(e.target.value)} />
              <Field label={t`Author`} value={author} onChange={(e) => setAuthor(e.target.value)} />
              <PickRow
                label={t`New book folder`}
                value={root ?? ""}
                placeholder={t`No folder chosen`}
                button={t`Choose…`}
                icon={FolderOpen}
                disabled={busy}
                onPick={() => pick(pickFolder, setRoot)}
                hint={t`Pick or create an empty folder. The imported book is stored there.`}
              />
            </>
          )}
          {errorBox}
          <div className="flex justify-end gap-2.5">
            <Button onClick={() => change(false)} disabled={busy}>{t`Cancel`}</Button>
            <Button type="submit" variant="primary" icon={ArrowRight} disabled={!ready}>
              {busy ? t`Reading…` : t`Next`}
            </Button>
          </div>
        </form>
      ) : (
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (kept > 0) submit();
          }}
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-xs font-semibold text-ink-muted">{t`Start a new chapter at`}</span>
            <Segmented
              label={t`Start a new chapter at`}
              value={String(preview.level) as "1" | "2" | "3"}
              onChange={(v) => setLevel(Number(v) as Level)}
              items={[
                { value: "1", label: t`Heading 1` },
                { value: "2", label: t`Heading 2` },
                { value: "3", label: t`Heading 3` },
              ]}
            />
          </div>
          <ImportChapterList result={preview.result} plan={preview.plan} onChange={setPlan} />
          <Summary result={preview.result} kept={kept} />
          {errorBox}
          <div className="flex justify-end gap-2.5">
            <Button
              icon={ArrowLeft}
              onClick={() => {
                setPreview(null);
                setError("");
              }}
              disabled={busy}
            >{t`Back`}</Button>
            <Button type="submit" variant="primary" icon={FileUp} disabled={kept === 0 || busy}>
              {append ? (busy ? t`Adding…` : t`Add to book`) : busy ? t`Importing…` : t`Import`}
            </Button>
          </div>
        </form>
      )}
    </Modal>
  );
}
