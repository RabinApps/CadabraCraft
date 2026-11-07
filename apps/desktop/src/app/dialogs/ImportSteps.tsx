import { useCallback, useState } from "react";
import { useLingui } from "@lingui/react/macro";
import { ArrowLeft, ArrowRight, FileUp, FolderOpen } from "lucide-react";
import type { ImportResult } from "@cadabracraft/import-docx";
import { Segmented } from "../../ui/forms/Segmented";
import { Button } from "../../ui/Button";
import { Field, focusField } from "../../ui/forms/Input";
import {
  outlineFormatFor,
  parseImport,
  sceneCountOf,
  titleFromFile,
  type LoadedSource,
} from "../../lib/import/importBook";
import { baseName } from "../../lib/paths";
import { causeText } from "../../lib/projectError";
import { initialPlan, keptCount, type ImportPlan } from "../../lib/import/importPlan";
import { ImportChapterList } from "./ImportChapterList";
import { PickRow, Summary } from "./ImportParts";
import { Notice } from "../../ui/feedback/Notice";

export type Level = 1 | 2 | 3;
/** The box a message is about, so it is marked invalid and read with the message. */
export type About = "file" | "title" | "folder" | null;

export const IDS = { file: "import-file", title: "import-title", folder: "import-folder" } as const;
export const ERROR_ID = "import-error";
export interface Preview {
  loaded: LoadedSource;
  level: Level;
  /** The file is read as an outline (chapters with scenes) rather than as a manuscript. */
  outline: boolean;
  result: ImportResult;
  plan: ImportPlan;
}

/** The scenes in the chapters the plan keeps (merged chapters count all their sources). */
export const keptScenes = (p: Preview): number =>
  p.plan
    .filter((item) => item.include)
    .reduce(
      (n, item) =>
        n + item.sources.reduce((m, s) => m + sceneCountOf(p.result.chapters[s]!.doc), 0),
      0,
    );

/** The message under the form and the box it is about. */
export function useImportFeedback() {
  const [error, setError] = useState("");
  const [about, setAbout] = useState<About>(null);
  const fail = (message: string, field: About = null) => {
    setAbout(field);
    setError(message);
    if (field) focusField(IDS[field]);
  };
  const clear = () => {
    setError("");
    setAbout(null);
  };
  return { error, about, setError, fail, clear };
}
export type Feedback = ReturnType<typeof useImportFeedback>;

/** What the author picked on the first step. */
export function useImportFields() {
  const [source, setSource] = useState<string | null>(null);
  const [root, setRoot] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [author, setAuthor] = useState("");
  const reset = () => {
    setSource(null);
    setRoot(null);
    setTitle("");
    setAuthor("");
  };
  return { source, setSource, root, setRoot, title, setTitle, author, setAuthor, reset };
}
export type Fields = ReturnType<typeof useImportFields>;

/** The chapter preview of the second step: parsing the source again at another heading level or as an outline. */
export function useImportPreview(
  feedback: Feedback,
  busy: boolean,
  setBusy: (busy: boolean) => void,
) {
  const { t } = useLingui();
  const { setError, fail } = feedback;
  const [preview, setPreview] = useState<Preview | null>(null);
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
  const rerun = (job: Promise<void>, failure: (e: unknown) => string) => {
    setBusy(true);
    setError("");
    job.catch((e) => fail(failure(e))).finally(() => setBusy(false));
  };
  // A Word document is parsed again in Rust, which can take a moment on a large manuscript: the buttons wait for it.
  const setLevel = (level: Level) => {
    if (!preview || busy) return;
    rerun(
      parse(preview.loaded, level, false),
      (e) =>
        t`Could not split the file at that heading level (${causeText(e)}). Pick another heading level, or go back and choose a different file.`,
    );
  };
  // Only a Markdown file can be either; an .opml or .csv file is always an outline.
  const setOutline = (outline: boolean) => {
    if (!preview || busy || outline === preview.outline) return;
    rerun(
      parse(preview.loaded, preview.level, outline),
      (e) =>
        t`Could not read the file that way (${causeText(e)}). Pick the other choice, or go back and choose a different file.`,
    );
  };
  const setPlan = useCallback((plan: ImportPlan) => setPreview((p) => p && { ...p, plan }), []);
  return { preview, setPreview, parse, setLevel, setOutline, setPlan };
}
export type PreviewState = ReturnType<typeof useImportPreview>;

/** The error message box. */
export function ErrorBox({ error }: { error: string }) {
  if (!error) return null;
  return (
    <Notice id={ERROR_ID} role="alert" className="max-h-40 overflow-y-auto wrap-break-word">
      {error}
    </Notice>
  );
}

/** First step: the file and, for a new book, its title, author and folder. */
export function PickStep({
  append,
  busy,
  fields,
  feedback,
  onPick,
  onNext,
  onCancel,
}: {
  append: boolean;
  busy: boolean;
  fields: Fields;
  feedback: Feedback;
  onPick: (f: "file" | "folder", then: (p: string) => void) => void;
  onNext: () => void;
  onCancel: () => void;
}) {
  const { t } = useLingui();
  const { error, about } = feedback;
  const { source, root, title, author } = fields;
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        onNext();
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
          onPick("file", (p) => {
            fields.setSource(p);
            fields.setTitle((cur) => cur || titleFromFile(p));
          })
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
              fields.setTitle(e.target.value);
              if (about === "title") feedback.setError("");
            }}
          />
          <Field
            label={t`Author`}
            value={author}
            onChange={(e) => fields.setAuthor(e.target.value)}
          />
          <PickRow
            label={t`New book folder`}
            value={root ?? ""}
            placeholder={t`No folder chosen`}
            button={t`Choose…`}
            icon={FolderOpen}
            disabled={busy}
            id={IDS.folder}
            errorId={error && about === "folder" ? ERROR_ID : undefined}
            onPick={() => onPick("folder", fields.setRoot)}
            hint={t`Pick or create an empty folder. The imported book is stored there.`}
          />
        </>
      )}
      <ErrorBox error={error} />
      <div className="flex justify-end gap-2.5">
        <Button onClick={onCancel} disabled={busy}>{t`Cancel`}</Button>
        <Button type="submit" variant="primary" icon={ArrowRight} disabled={busy}>
          {busy ? t`Reading…` : t`Next`}
        </Button>
      </div>
    </form>
  );
}

/** Second step: how the source splits into chapters, with the last button that writes. */
export function PreviewStep({
  preview,
  state,
  append,
  busy,
  error,
  onBack,
  onSubmit,
}: {
  preview: Preview;
  state: PreviewState;
  append: boolean;
  busy: boolean;
  error: string;
  onBack: () => void;
  onSubmit: () => void;
}) {
  const { t } = useLingui();
  const kept = keptCount(preview.plan);
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (kept > 0) onSubmit();
      }}
    >
      {outlineFormatFor(preview.loaded, true) === "markdown" && (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-xs font-semibold text-ink-muted">{t`Read this file as`}</span>
          <Segmented
            label={t`Read this file as`}
            value={preview.outline ? "outline" : "manuscript"}
            onChange={(v) => state.setOutline(v === "outline")}
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
            onChange={(v) => state.setLevel(Number(v) as Level)}
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
        onChange={state.setPlan}
        outline={preview.outline}
      />
      <Summary
        result={preview.result}
        kept={kept}
        scenes={preview.outline ? keptScenes(preview) : undefined}
      />
      <ErrorBox error={error} />
      <div className="flex justify-end gap-2.5">
        <Button icon={ArrowLeft} onClick={onBack} disabled={busy}>{t`Back`}</Button>
        <Button type="submit" variant="primary" icon={FileUp} disabled={kept === 0 || busy}>
          {append ? (busy ? t`Adding…` : t`Add to book`) : busy ? t`Importing…` : t`Import`}
        </Button>
      </div>
    </form>
  );
}
