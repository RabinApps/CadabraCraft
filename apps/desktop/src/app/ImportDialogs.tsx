import { useState } from "react";
import * as D from "@radix-ui/react-dialog";
import { useLingui } from "@lingui/react/macro";
import { plural } from "@lingui/core/macro";
import { Copy, FileUp, FolderOpen } from "lucide-react";
import { Badge } from "../ui/Badge";
import { Button } from "../ui/Button";
import { Modal, overlayClass, panelClass } from "../ui/Dialog";
import { Field } from "../ui/Input";
import { baseName, formatReport, groupWarnings, titleFromFile } from "./importBook";
import { useProject } from "./store";

interface ImportProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  pickSource: () => Promise<string | null>;
  pickFolder: () => Promise<string | null>;
  onImport: (source: string, root: string, title: string, author: string) => Promise<void>;
}

/** Pick a source file and a destination folder; the import always creates a new project there and only reads the source. */
export function ImportDialog({ open, onOpenChange, pickSource, pickFolder, onImport }: ImportProps) {
  const { t } = useLingui();
  const [source, setSource] = useState<string | null>(null);
  const [root, setRoot] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [author, setAuthor] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const ready = source !== null && root !== null && title.trim() !== "" && !busy;
  const change = (o: boolean) => {
    if (busy) return;
    if (!o) { setSource(null); setRoot(null); setTitle(""); setAuthor(""); setError(""); }
    onOpenChange(o);
  };
  const pick = (f: () => Promise<string | null>, then: (p: string) => void) => {
    setError("");
    f().then((p) => p && then(p)).catch((e) => setError(String(e instanceof Error ? e.message : e)));
  };
  return (
    <Modal open={open} onOpenChange={change} title={t`Import a manuscript`} description={t`Creates a new book from a Word (.docx) or Markdown file. The original file is never changed.`}>
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (!ready) return;
          setBusy(true);
          setError("");
          onImport(source, root, title.trim(), author.trim() || t`Unknown`)
            .then(() => { setBusy(false); change(false); })
            .catch((err) => { setBusy(false); setError(String(err instanceof Error ? err.message : err)); });
        }}
      >
        <PickRow label={t`File`} value={source ? baseName(source) : ""} placeholder={t`No file chosen`} button={t`Choose file…`} icon={FileUp} onPick={() => pick(pickSource, (p) => { setSource(p); setTitle((cur) => cur || titleFromFile(p)); })} />
        <Field label={t`Title`} value={title} onChange={(e) => setTitle(e.target.value)} />
        <Field label={t`Author`} value={author} onChange={(e) => setAuthor(e.target.value)} />
        <PickRow label={t`New book folder`} value={root ?? ""} placeholder={t`No folder chosen`} button={t`Choose…`} icon={FolderOpen} onPick={() => pick(pickFolder, setRoot)} hint={t`Pick or create an empty folder. The imported book is stored there.`} />
        {error && <p role="alert" className="max-h-40 overflow-y-auto break-words rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}
        <div className="flex justify-end gap-2.5">
          <Button onClick={() => change(false)} disabled={busy}>{t`Cancel`}</Button>
          <Button type="submit" variant="primary" icon={FileUp} disabled={!ready}>{busy ? t`Importing…` : t`Import`}</Button>
        </div>
      </form>
    </Modal>
  );
}

function PickRow({ label, value, placeholder, button, icon, onPick, hint }: { label: string; value: string; placeholder: string; button: string; icon: typeof FileUp; onPick: () => void; hint?: string }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-xs font-semibold text-ink-muted">{label}</span>
      <div className="flex gap-2">
        <input aria-label={label} readOnly value={value} placeholder={placeholder} className="min-w-0 flex-1 rounded-md border border-border bg-surface px-3 py-2.5 text-sm text-ink-muted placeholder:text-ink-muted" />
        <Button icon={icon} onClick={onPick}>{button}</Button>
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
