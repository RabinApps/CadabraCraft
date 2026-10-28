import { useRef, useState } from "react";
import { useLingui } from "@lingui/react/macro";
import { plural } from "@lingui/core/macro";
import { ArrowLeft, ArrowRight, FileUp, FolderOpen } from "lucide-react";
import { countWords } from "@cadabracraft/shared";
import type { ImportResult } from "@cadabracraft/import-docx";
import { Segmented } from "../../ui/Segmented";
import { Button } from "../../ui/Button";
import { Modal } from "../../ui/Dialog";
import { Field } from "../../ui/Input";
import {
  loadImport,
  parseImport,
  titleFromFile,
  type ChapterEdit,
  type ImportChoices,
  type LoadedSource,
} from "../../lib/importBook";
import { baseName } from "../../lib/paths";
import { errText } from "../../lib/projectError";
import { PickRow, Summary } from "./ImportParts";

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
}

type Level = 1 | 2 | 3;
interface Preview {
  loaded: LoadedSource;
  level: Level;
  result: ImportResult;
  edits: ChapterEdit[];
}

const freshEdits = (r: ImportResult): ChapterEdit[] =>
  r.chapters.map((c) => ({ title: c.title, include: true }));

/** Two steps: pick a source and destination, then preview how it splits into chapters. Only the last button writes; the source is only read. */
export function ImportDialog({
  open,
  onOpenChange,
  pickSource,
  pickFolder,
  onImport,
}: ImportProps) {
  const { t } = useLingui();
  const [source, setSource] = useState<string | null>(null);
  const [root, setRoot] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [author, setAuthor] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const ready = source !== null && root !== null && title.trim() !== "" && !busy;
  const kept = preview ? preview.edits.filter((e) => e.include).length : 0;
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
  const parse = (loaded: LoadedSource, level: Level) => {
    const result = parseImport(loaded, level);
    setPreview({ loaded, level, result, edits: freshEdits(result) });
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
  const setLevel = (level: Level) => {
    if (!preview) return;
    setError("");
    try {
      parse(preview.loaded, level);
    } catch (e) {
      setError(errText(e));
    }
  };
  const edit = (i: number, patch: Partial<ChapterEdit>) =>
    setPreview(
      (p) => p && { ...p, edits: p.edits.map((e, j) => (j === i ? { ...e, ...patch } : e)) },
    );
  const submit = () => {
    if (!source || !root || busy) return;
    setBusy(true);
    setError("");
    onImport(
      source,
      root,
      title.trim(),
      author.trim() || t`Unknown`,
      preview ? { splitHeadingLevel: preview.level, edits: preview.edits } : undefined,
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
    <p
      role="alert"
      className="max-h-40 overflow-y-auto break-words rounded-md bg-danger-soft px-3 py-2 text-sm text-danger"
    >
      {error}
    </p>
  );
  return (
    <Modal
      open={open}
      onOpenChange={change}
      title={t`Import a manuscript`}
      description={t`Creates a new book from a Word (.docx), Markdown or HTML file. The original file is never changed.`}
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
          <ul
            aria-label={t`Chapters`}
            className="flex max-h-72 flex-col gap-2 overflow-y-auto rounded-md border border-border bg-surface p-3"
          >
            {preview.result.chapters.map((c, i) => (
              <li key={`${preview.level}-${i}`} className="flex items-center gap-2.5">
                <input
                  type="checkbox"
                  aria-label={t`Include chapter ${i + 1}`}
                  checked={preview.edits[i]!.include}
                  onChange={(e) => edit(i, { include: e.target.checked })}
                  className="size-4 shrink-0 accent-accent"
                />
                <input
                  aria-label={t`Title of chapter ${i + 1}`}
                  value={preview.edits[i]!.title}
                  disabled={!preview.edits[i]!.include}
                  onChange={(e) => edit(i, { title: e.target.value })}
                  className="min-w-0 flex-1 rounded-md border border-border bg-bg px-2.5 py-1.5 text-sm disabled:text-ink-muted"
                />
                <span className="shrink-0 text-xs text-ink-muted">
                  {plural(countWords(c.doc), { one: "# word", other: "# words" })}
                </span>
              </li>
            ))}
          </ul>
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
              {busy ? t`Importing…` : t`Import`}
            </Button>
          </div>
        </form>
      )}
    </Modal>
  );
}
