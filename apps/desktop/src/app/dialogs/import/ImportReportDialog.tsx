import { useState } from "react";
import * as D from "@radix-ui/react-dialog";
import { useLingui } from "@lingui/react/macro";
import { plural } from "@lingui/core/macro";
import { Copy } from "lucide-react";
import { Badge } from "../../../ui/feedback/Badge";
import { Button } from "../../../ui/Button";
import { overlayClass, panelClass } from "../../../ui/Dialog";
import { formatReport, groupWarnings } from "../../../lib/import/importBook";
import { useProject } from "../../../state/project/index";

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
  const copy = () =>
    navigator.clipboard.writeText(formatReport(report)).then(
      () => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      },
      () => {},
    );
  return (
    <D.Root
      open
      onOpenChange={(o) => {
        if (!o) {
          setCopied(false);
          dismiss();
        }
      }}
    >
      <D.Portal>
        <D.Overlay className={overlayClass} />
        <D.Content
          className={`${panelClass} left-1/2 top-1/2 flex max-h-[85dvh] w-[min(92vw,560px)] -translate-x-1/2 -translate-y-1/2 flex-col rounded-lg p-6`}
        >
          <D.Title className="font-book text-title font-semibold">{t`Import report`}</D.Title>
          <D.Description className="mt-2 text-sm text-ink-muted">
            {plural(chapterCount, {
              one: `Imported # chapter from ${fileName}.`,
              other: `Imported # chapters from ${fileName}.`,
            })}{" "}
            {plural(imageCount, { one: "# image added.", other: "# images added." })}
          </D.Description>
          <div
            className="mt-4 min-h-0 flex-1 overflow-y-auto rounded-md border border-border bg-surface p-3"
            tabIndex={0}
            role="region"
            aria-label={t`Import warnings`}
          >
            {groups.length === 0 ? (
              <p className="text-sm text-ink-muted">{t`Nothing was lost or changed.`}</p>
            ) : (
              <>
                <p className="mb-3 text-sm text-ink-muted">
                  {lost > 0
                    ? t`Some content or formatting could not be kept. Review these before you continue.`
                    : t`These are routine adjustments; nothing was lost.`}
                </p>
                <ul className="flex flex-col gap-3">
                  {groups.map((g) => (
                    <li key={g.code} className="text-sm">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge tone={g.severity === "warning" ? "warn" : "success"}>
                          {g.severity === "warning" ? t`Warning` : t`Note`}
                        </Badge>
                        <code className="text-xs">{g.code}</code>
                        <span className="text-xs text-ink-muted">×{g.count}</span>
                      </div>
                      <p className="mt-1 break-words">{g.message}</p>
                      {g.examples.length > 0 && (
                        <ul className="mt-1 list-disc ps-5 text-xs text-ink-muted">
                          {g.examples.map((e) => (
                            <li key={e} className="break-words">
                              {e}
                            </li>
                          ))}
                        </ul>
                      )}
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
          <div className="mt-4 flex justify-end gap-2.5">
            <Button icon={Copy} onClick={() => void copy()}>
              {copied ? t`Copied` : t`Copy report`}
            </Button>
            <D.Close asChild>
              <Button variant="primary">{t`Done`}</Button>
            </D.Close>
          </div>
        </D.Content>
      </D.Portal>
    </D.Root>
  );
}
