import { useLingui } from "@lingui/react/macro";
import { Upload, X } from "lucide-react";
import { useProject } from "../../../state/project/index";
import { attempt } from "../../../state/attempt";
import { Button } from "../../../ui/Button";
import { cx } from "../../../ui/cx";
import { Notice } from "../../../ui/feedback/Notice";
import { ProgressBar } from "../../../ui/feedback/ProgressBar";

type Importing = NonNullable<ReturnType<typeof useProject.getState>["referenceImport"]>;

export function ImportProgress({ importing }: { importing: Importing }) {
  const { t } = useLingui();
  return (
    <div
      className="flex flex-col gap-2 rounded-md border border-border bg-surface p-3"
      role="status"
    >
      <div className="flex justify-between gap-2 text-sm font-semibold">
        <span className="min-w-0 truncate">{importing.name}</span>
        <span className="text-xs text-ink-muted">{`${importing.index} / ${importing.total}`}</span>
      </div>
      <ProgressBar
        label={t`Adding ${importing.name}`}
        value={importing.index - 1}
        max={importing.total}
        className="h-2 bg-border"
      />
    </div>
  );
}

export function EmptyReferences() {
  const { t } = useLingui();
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 px-2 text-center">
      <span className="flex size-14 items-center justify-center rounded-full bg-accent-soft text-accent">
        <Upload size={26} aria-hidden />
      </span>
      <h3 className="text-lead font-semibold">{t`Keep your research close`}</h3>
      <p className="max-w-60 text-sm text-ink-muted">
        {t`Add images, videos, PDFs, audio, links and notes you want to look at while you write. They stay in the book.`}
      </p>
    </div>
  );
}

type RefNotices = ReturnType<typeof useProject.getState>["referenceNotices"];

export function Notices({ notices }: { notices: RefNotices }) {
  const { t } = useLingui();
  const actions = useProject((s) => s.actions);
  if (notices.length === 0) return null;
  return (
    <div className="flex flex-col gap-2">
      {notices.map((n, i) => (
        <Notice key={i} tone={n.tone} role={n.tone === "danger" ? "alert" : "status"}>
          {n.text}
        </Notice>
      ))}
      <Button size="sm" icon={X} onClick={actions.dismissReferenceNotices}>{t`Dismiss`}</Button>
    </div>
  );
}

/** The dashed button under the list: choosing files by clicking it, and the place the drop highlight shows its message. */
export function DropZone({ active }: { active: boolean }) {
  const { t } = useLingui();
  const actions = useProject((s) => s.actions);
  return (
    <button
      type="button"
      onClick={() => attempt(actions.addReferences())}
      className={cx(
        "flex flex-col items-center gap-1.5 rounded-md border border-dashed p-4 text-sm hover:bg-accent-soft/60 focus-visible:outline-2 focus-visible:outline-accent",
        active
          ? "border-solid border-accent bg-accent-soft font-semibold text-ink"
          : "border-border-strong text-ink-muted",
      )}
    >
      <Upload size={18} aria-hidden />
      {active ? t`Release to add files, links or text` : t`Drop files, links or text here`}
    </button>
  );
}
