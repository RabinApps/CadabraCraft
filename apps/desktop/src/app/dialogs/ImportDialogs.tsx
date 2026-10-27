import { useRef, useState } from "react";
import * as D from "@radix-ui/react-dialog";
import { useLingui } from "@lingui/react/macro";
import { plural } from "@lingui/core/macro";
import { ArrowLeft, ArrowRight, Copy, FileUp, FolderOpen } from "lucide-react";
import { countWords } from "@cadabracraft/shared";
import type { ImportResult } from "@cadabracraft/import-docx";
import { Segmented } from "../../ui/Segmented";
import { Badge } from "../../ui/Badge";
import { Button } from "../../ui/Button";
import { Modal, overlayClass, panelClass } from "../../ui/Dialog";
import { Field } from "../../ui/Input";
import { baseName, formatReport, groupWarnings, loadImport, parseImport, titleFromFile, type ChapterEdit, type ImportChoices, type LoadedSource } from "../../lib/importBook";
import { useProject } from "../../state/project/index";
import { errText } from "../../lib/projectError";

interface ImportProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  pickSource: () => Promise<string | null>;
  pickFolder: () => Promise<string | null>;
  onImport: (source: string, root: string, title: string, author: string, opts?: ImportChoices) => Promise<void>;
}

type Level = 1 | 2 | 3;
interface Preview { loaded: LoadedSource; level: Level; result: ImportResult; edits: ChapterEdit[] }

const freshEdits = (r: ImportResult): ChapterEdit[] => r.chapters.map((c) => ({ title: c.title, include: true }));

/** Two steps: pick a source and destination, then preview how it splits into chapters. Only the last button writes; the source is only read. */
export function ImportDialog({ open, onOpenChange, pickSource, pickFolder, onImport }: ImportProps) {
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
    if (!o) { gen.current++; setSource(null); setRoot(null); setTitle(""); setAuthor(""); setPreview(null); setError(""); }
    onOpenChange(o);
  };
  const pick = (f: () => Promise<string | null>, then: (p: string) => void) => {
    if (busy) return;
    setError("");
    const mine = gen.current;
    // A cancelled picker answers null; a picker that answers after the dialog was closed is ignored.
    f().then((p) => { if (p && mine === gen.current) then(p); }).catch((e) => { if (mine === gen.current) setError(errText(e)); });
  };
  const parse = (loaded: LoadedSource, level: Level) => {
    const result = parseImport(loaded, level);
    setPreview({ loaded, level, result, edits: freshEdits(result) });
  };
  const next = () => {
    if (!source || busy) return;
    setBusy(true);
    setError("");
    loadImport(source).then((l) => parse(l, 1)).catch((e) => setError(errText(e))).finally(() => setBusy(false));
  };
  const setLevel = (level: Level) => {
    if (!preview) return;
    setError("");
    try { parse(preview.loaded, level); } catch (e) { setError(errText(e)); }
  };
  const edit = (i: number, patch: Partial<ChapterEdit>) =>
    setPreview((p) => p && { ...p, edits: p.edits.map((e, j) => (j === i ? { ...e, ...patch } : e)) });
  const submit = () => {
    if (!source || !root || busy) return;
    setBusy(true);
    setError("");
    onImport(source, root, title.trim(), author.trim() || t`Unknown`, preview ? { splitHeadingLevel: preview.level, edits: preview.edits } : undefined)
      .then(() => { setBusy(false); change(false); })
      .catch((err) => { setBusy(false); setError(errText(err)); });
  };
  const errorBox = error && <p role="alert" className="max-h-40 overflow-y-auto break-words rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>;
  return (
    <Modal open={open} onOpenChange={change} title={t`Import a manuscript`} description={t`Creates a new book from a Word (.docx), Markdown or HTML file. The original file is never changed.`}>
      {!preview ? (
        <form className="flex flex-col gap-4" onSubmit={(e) => { e.preventDefault(); if (ready) next(); }}>
          <PickRow label={t`File`} value={source ? baseName(source) : ""} placeholder={t`No file chosen`} button={t`Choose file…`} icon={FileUp} disabled={busy} onPick={() => pick(pickSource, (p) => { setSource(p); setTitle((cur) => cur || titleFromFile(p)); })} />
          <Field label={t`Title`} value={title} onChange={(e) => setTitle(e.target.value)} />
          <Field label={t`Author`} value={author} onChange={(e) => setAuthor(e.target.value)} />
          <PickRow label={t`New book folder`} value={root ?? ""} placeholder={t`No folder chosen`} button={t`Choose…`} icon={FolderOpen} disabled={busy} onPick={() => pick(pickFolder, setRoot)} hint={t`Pick or create an empty folder. The imported book is stored there.`} />
          {errorBox}
          <div className="flex justify-end gap-2.5">
            <Button onClick={() => change(false)} disabled={busy}>{t`Cancel`}</Button>
            <Button type="submit" variant="primary" icon={ArrowRight} disabled={!ready}>{busy ? t`Reading…` : t`Next`}</Button>
          </div>
        </form>
      ) : (
        <form className="flex flex-col gap-4" onSubmit={(e) => { e.preventDefault(); if (kept > 0) submit(); }}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-xs font-semibold text-ink-muted">{t`Start a new chapter at`}</span>
            <Segmented label={t`Start a new chapter at`} value={String(preview.level) as "1" | "2" | "3"} onChange={(v) => setLevel(Number(v) as Level)} items={[{ value: "1", label: t`Heading 1` }, { value: "2", label: t`Heading 2` }, { value: "3", label: t`Heading 3` }]} />
          </div>
          <ul aria-label={t`Chapters`} className="flex max-h-72 flex-col gap-2 overflow-y-auto rounded-md border border-border bg-surface p-3">
            {preview.result.chapters.map((c, i) => (
              <li key={`${preview.level}-${i}`} className="flex items-center gap-2.5">
                <input type="checkbox" aria-label={t`Include chapter ${i + 1}`} checked={preview.edits[i]!.include} onChange={(e) => edit(i, { include: e.target.checked })} className="size-4 shrink-0 accent-accent" />
                <input aria-label={t`Title of chapter ${i + 1}`} value={preview.edits[i]!.title} disabled={!preview.edits[i]!.include} onChange={(e) => edit(i, { title: e.target.value })} className="min-w-0 flex-1 rounded-md border border-border bg-bg px-2.5 py-1.5 text-sm disabled:text-ink-muted" />
                <span className="shrink-0 text-xs text-ink-muted">{plural(countWords(c.doc), { one: "# word", other: "# words" })}</span>
              </li>
            ))}
          </ul>
          <Summary result={preview.result} kept={kept} />
          {errorBox}
          <div className="flex justify-end gap-2.5">
            <Button icon={ArrowLeft} onClick={() => { setPreview(null); setError(""); }} disabled={busy}>{t`Back`}</Button>
            <Button type="submit" variant="primary" icon={FileUp} disabled={kept === 0 || busy}>{busy ? t`Importing…` : t`Import`}</Button>
          </div>
        </form>
      )}
    </Modal>
  );
}

function Summary({ result, kept }: { result: ImportResult; kept: number }) {
  const { t } = useLingui();
  const groups = groupWarnings(result.warnings);
  const lost = groups.filter((g) => g.severity === "warning");
  return (
    <p className="text-sm text-ink-muted" role="status">
      {plural(kept, { one: "# chapter will be imported.", other: "# chapters will be imported." })}{" "}
      {lost.length > 0 ? t`Some content could not be kept: ${lost.map((g) => g.code).join(", ")}. A full report follows the import.` : t`Nothing was lost or changed.`}
    </p>
  );
}

function PickRow({ label, value, placeholder, button, icon, onPick, hint, disabled }: { label: string; value: string; placeholder: string; button: string; icon: typeof FileUp; onPick: () => void; hint?: string; disabled?: boolean }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-xs font-semibold text-ink-muted">{label}</span>
      <div className="flex gap-2">
        <input aria-label={label} readOnly value={value} placeholder={placeholder} className="min-w-0 flex-1 rounded-md border border-border bg-surface px-3 py-2.5 text-sm text-ink-muted placeholder:text-ink-muted" />
        <Button icon={icon} onClick={onPick} disabled={disabled}>{button}</Button>
      </div>
      {hint && <p className="text-xs text-ink-muted">{hint}</p>}
    </div>
  );
}

/** Shown after an import: chapter and image counts, and warnings grouped by code. */
export function ImportReportDialog() {
  const { t } = useLingui();
  const report = useProject((s) => s.importReport);
  const dismiss = useProject((s) => s.actions.dismissImportReport);
  const [copied, setCopied] = useState(false);
  if (!report) return null;
  const { fileName, chapterCount, imageCount } = report;
  const groups = groupWarnings(report.warnings);
  const lost = groups.filter((g) => g.severity === "warning").length;
  const copy = () => navigator.clipboard.writeText(formatReport(report)).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); }, () => {});
  return (
    <D.Root open onOpenChange={(o) => { if (!o) { setCopied(false); dismiss(); } }}>
      <D.Portal>
        <D.Overlay className={overlayClass} />
        <D.Content className={`${panelClass} left-1/2 top-1/2 flex max-h-[85dvh] w-[min(92vw,560px)] -translate-x-1/2 -translate-y-1/2 flex-col rounded-lg p-6`}>
          <D.Title className="font-book text-xl font-semibold">{t`Import report`}</D.Title>
          <D.Description className="mt-2 text-sm text-ink-muted">
            {plural(chapterCount, { one: `Imported # chapter from ${fileName}.`, other: `Imported # chapters from ${fileName}.` })}{" "}
            {plural(imageCount, { one: "# image added.", other: "# images added." })}
          </D.Description>
          <div className="mt-4 min-h-0 flex-1 overflow-y-auto rounded-md border border-border bg-surface p-3" tabIndex={0} role="region" aria-label={t`Import warnings`}>
            {groups.length === 0 ? (
              <p className="text-sm text-ink-muted">{t`Nothing was lost or changed.`}</p>
            ) : (
              <>
                <p className="mb-3 text-sm text-ink-muted">{lost > 0 ? t`Some content or formatting could not be kept. Review these before you continue.` : t`These are routine adjustments; nothing was lost.`}</p>
                <ul className="flex flex-col gap-3">
                  {groups.map((g) => (
                    <li key={g.code} className="text-sm">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge tone={g.severity === "warning" ? "warn" : "success"}>{g.severity === "warning" ? t`Warning` : t`Note`}</Badge>
                        <code className="text-xs">{g.code}</code>
                        <span className="text-xs text-ink-muted">×{g.count}</span>
                      </div>
                      <p className="mt-1 break-words">{g.message}</p>
                      {g.examples.length > 0 && (
                        <ul className="mt-1 list-disc ps-5 text-xs text-ink-muted">
                          {g.examples.map((e) => <li key={e} className="break-words">{e}</li>)}
                        </ul>
                      )}
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
          <div className="mt-4 flex justify-end gap-2.5">
            <Button icon={Copy} onClick={() => void copy()}>{copied ? t`Copied` : t`Copy report`}</Button>
            <D.Close asChild><Button variant="primary">{t`Done`}</Button></D.Close>
          </div>
        </D.Content>
      </D.Portal>
    </D.Root>
  );
}
