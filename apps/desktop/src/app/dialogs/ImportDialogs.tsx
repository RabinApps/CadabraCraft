import { useCallback, useRef, useState } from "react";
import { useLingui } from "@lingui/react/macro";
import { ArrowLeft, ArrowRight, FileUp, FolderOpen } from "lucide-react";
import type { ImportResult } from "@cadabracraft/import-docx";
import { Segmented } from "../../ui/Segmented";
import { Button } from "../../ui/Button";
import { Modal } from "../../ui/Dialog";
import { Field, focusField } from "../../ui/Input";
import {
  loadImport,
  outlineFormatFor,
  parseImport,
  sceneCountOf,
  titleFromFile,
  type ImportChoices,
  type LoadedSource,
} from "../../lib/importBook";
import { baseName } from "../../lib/paths";
import { causeText } from "../../lib/projectError";
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
/** The box a message is about, so it is marked invalid and read with the message. */
type About = "file" | "title" | "folder" | null;

const IDS = { file: "import-file", title: "import-title", folder: "import-folder" } as const;
const ERROR_ID = "import-error";
interface Preview {
  loaded: LoadedSource;
  level: Level;
  /** The file is read as an outline (chapters with scenes) rather than as a manuscript. */
  outline: boolean;
  result: ImportResult;
  plan: ImportPlan;
}

/** The scenes in the chapters the plan keeps (merged chapters count all their sources). */
const keptScenes = (p: Preview): number =>
  p.plan
    .filter((item) => item.include)
    .reduce(
      (n, item) =>
        n + item.sources.reduce((m, s) => m + sceneCountOf(p.result.chapters[s]!.doc), 0),
      0,
    );

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
  const [about, setAbout] = useState<About>(null);
  const [busy, setBusy] = useState(false);
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
      setAbout(null);
    }
    onOpenChange(o);
  };
  const fail = (message: string, field: About = null) => {
    setAbout(field);
    setError(message);
    if (field) focusField(IDS[field]);
  };
  const pick = (f: () => Promise<string | null>, then: (p: string) => void, field: About) => {
    if (busy) return;
    setError("");
    setAbout(null);
    const mine = gen.current;
    // A cancelled picker answers null; a picker that answers after the dialog was closed is ignored.
    f()
      .then((p) => {
        if (p && mine === gen.current) then(p);
      })
      .catch((e) => {
        if (mine === gen.current)
          fail(t`Could not open the chooser (${causeText(e)}). Try again.`, field);
      });
  };
  const parse = async (loaded: LoadedSource, level: Level, asOutline: boolean) => {
    const result = await parseImport(loaded, level, asOutline);
    setPreview({
      loaded,
      level,
      outline: outlineFormatFor(loaded, asOutline) !== null,
      result,
      plan: initialPlan(result),
    });
  };
  const next = () => {
    if (busy) return;
    // The button is not dead: pressing it says what is missing and puts the cursor there.
    if (!source) return fail(t`No file is chosen. Choose the file to import.`, "file");
    if (!append && !title.trim()) return fail(t`The book has no title. Type one.`, "title");
    if (!append && !root)
      return fail(t`No folder is chosen. Choose an empty folder for the new book.`, "folder");
    setBusy(true);
    setError("");
    setAbout(null);
    loadImport(source)
      .then((l) => parse(l, 1, false))
      .catch((e) =>
        fail(
          t`Could not read this file (${causeText(e)}). Choose a different file (Word .docx, Markdown or HTML) and try again.`,
          "file",
        ),
      )
      .finally(() => setBusy(false));
  };
  // A Word document is parsed again in Rust, which can take a moment on a large manuscript: the buttons wait for it.
  const setLevel = (level: Level) => {
    if (!preview || busy) return;
    setBusy(true);
    setError("");
    parse(preview.loaded, level, false)
      .catch((e) =>
        fail(
          t`Could not split the file at that heading level (${causeText(e)}). Pick another heading level, or go back and choose a different file.`,
        ),
      )
      .finally(() => setBusy(false));
  };
  // Only a Markdown file can be either; an .opml or .csv file is always an outline.
  const setOutline = (outline: boolean) => {
    if (!preview || busy || outline === preview.outline) return;
    setBusy(true);
    setError("");
    parse(preview.loaded, preview.level, outline)
      .catch((e) =>
        fail(
          t`Could not read the file that way (${causeText(e)}). Pick the other choice, or go back and choose a different file.`,
        ),
      )
      .finally(() => setBusy(false));
  };
  const setPlan = useCallback((plan: ImportPlan) => setPreview((p) => p && { ...p, plan }), []);
  const submit = () => {
    if (!source || busy || (!append && !root)) return;
    setBusy(true);
    setError("");
    const choices = preview
      ? { splitHeadingLevel: preview.level, plan: preview.plan, outline: preview.outline }
      : undefined;
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
        fail(
          t`Could not import (${causeText(err)}). Your original file was not changed. Try again, or go back and choose a different file.`,
        );
      });
  };
  const errorBox = error && (
    <Notice id={ERROR_ID} role="alert" className="max-h-40 overflow-y-auto wrap-break-word">
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
            next();
          }}
        >
          <PickRow
            label={t`File`}
            value={source ? baseName(source) : ""}
            placeholder={t`No file chosen`}
            button={t`Choose file…`}
            icon={FileUp}
            disabled={busy}
            id={IDS.file}
            errorId={error && about === "file" ? ERROR_ID : undefined}
            onPick={() =>
              pick(
                pickSource,
                (p) => {
                  setSource(p);
                  setTitle((cur) => cur || titleFromFile(p));
                },
                "file",
              )
            }
          />
          {!append && (
            <>
              <Field
                id={IDS.title}
                label={t`Title`}
                value={title}
                errorId={error && about === "title" ? ERROR_ID : undefined}
                onChange={(e) => {
                  setTitle(e.target.value);
                  if (about === "title") setError("");
                }}
              />
              <Field label={t`Author`} value={author} onChange={(e) => setAuthor(e.target.value)} />
              <PickRow
                label={t`New book folder`}
                value={root ?? ""}
                placeholder={t`No folder chosen`}
                button={t`Choose…`}
                icon={FolderOpen}
                disabled={busy}
                id={IDS.folder}
                errorId={error && about === "folder" ? ERROR_ID : undefined}
                onPick={() => pick(pickFolder, setRoot, "folder")}
                hint={t`Pick or create an empty folder. The imported book is stored there.`}
              />
            </>
          )}
          {errorBox}
          <div className="flex justify-end gap-2.5">
            <Button onClick={() => change(false)} disabled={busy}>{t`Cancel`}</Button>
            <Button type="submit" variant="primary" icon={ArrowRight} disabled={busy}>
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
          {outlineFormatFor(preview.loaded, true) === "markdown" && (
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-xs font-semibold text-ink-muted">{t`Read this file as`}</span>
              <Segmented
                label={t`Read this file as`}
                value={preview.outline ? "outline" : "manuscript"}
                onChange={(v) => setOutline(v === "outline")}
                items={[
                  { value: "manuscript", label: t`Manuscript` },
                  { value: "outline", label: t`Outline` },
                ]}
              />
            </div>
          )}
          {!preview.outline && (
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
          )}
          <ImportChapterList
            result={preview.result}
            plan={preview.plan}
            onChange={setPlan}
            outline={preview.outline}
          />
          <Summary
            result={preview.result}
            kept={kept}
            scenes={preview.outline ? keptScenes(preview) : undefined}
          />
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
