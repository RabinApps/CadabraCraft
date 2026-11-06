import { useEffect, useState } from "react";
import { useLingui } from "@lingui/react/macro";
import { i18n } from "@lingui/core";
import { Loader, Undo2 } from "lucide-react";
import { referenceKind, stampDate, titleFromFile } from "../../lib/references/referenceKinds";
import { useProject } from "../../state/project/index";
import { Button } from "../../ui/Button";
import { Modal } from "../../ui/Dialog";
import { Notice } from "../../ui/feedback/Notice";
import { kindIcon, useKindLabel } from "./ReferenceRow";

/** "2 days ago", "yesterday": the age of a trash stamp in the app's language. */
function ago(stamp: string, now = Date.now()): string {
  const at = stampDate(stamp);
  if (!at) return "";
  const minutes = Math.round((at.getTime() - now) / 60000);
  const rtf = new Intl.RelativeTimeFormat(i18n.locale, { numeric: "auto" });
  const [value, unit]: [number, Intl.RelativeTimeFormatUnit] =
    Math.abs(minutes) < 60
      ? [minutes, "minute"]
      : Math.abs(minutes) < 60 * 24
        ? [Math.round(minutes / 60), "hour"]
        : [Math.round(minutes / 60 / 24), "day"];
  return rtf.format(value, unit);
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/** Reference files removed from the book, kept in the project trash. Restoring lists the file again as a new reference. */
export function RemovedReferencesDialog({ open, onOpenChange }: Props) {
  const { t } = useLingui();
  const removed = useProject((s) => s.removedReferences);
  const actions = useProject((s) => s.actions);
  const label = useKindLabel();
  const [busy, setBusy] = useState<string | null>(null);
  const [failed, setFailed] = useState<{ path: string; text: string } | null>(null);
  useEffect(() => {
    if (open) void actions.refreshRemovedReferences();
  }, [open, actions]);
  const restore = async (path: string) => {
    setBusy(path);
    setFailed(null);
    const text = await actions.restoreReference(path);
    setBusy(null);
    if (text) setFailed({ path, text });
  };
  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={t`Removed references`}
      description={t`Restoring adds the file back as a new reference, titled from its file name. The note, tags and chapter links it had are not kept.`}
      size="md"
    >
      {removed.length === 0 ? (
        <div className="flex flex-col items-center gap-1 py-6 text-center">
          <p className="text-lead font-semibold">{t`Nothing removed`}</p>
          <p className="max-w-72 text-sm text-ink-muted">
            {t`References you remove from the book show up here, so you can bring them back.`}
          </p>
        </div>
      ) : (
        <ul className="m-0 flex max-h-80 list-none flex-col overflow-y-auto p-0">
          {removed.map((r) => {
            const kind = referenceKind(r.original);
            const Icon = kindIcon(kind);
            const name = r.original.split("/").pop()!;
            return (
              <li key={r.path} className="border-b border-border py-2.5 last:border-b-0">
                <div className="flex items-center gap-3">
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-sm bg-accent-soft text-accent">
                    <Icon size={18} aria-hidden />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold">{name}</span>
                    <span className="block truncate text-xs text-ink-muted">
                      {t`${label(kind)} · Removed ${ago(r.stamp)}`}
                    </span>
                  </span>
                  <Button
                    size="sm"
                    icon={busy === r.path ? Loader : Undo2}
                    disabled={busy !== null}
                    aria-label={t`Restore ${titleFromFile(name)}`}
                    onClick={() => void restore(r.path)}
                  >
                    {busy === r.path ? t`Restoring…` : t`Restore`}
                  </Button>
                </div>
                {failed?.path === r.path && (
                  <Notice tone="danger" role="alert" className="mt-2">
                    {failed.text}
                  </Notice>
                )}
              </li>
            );
          })}
        </ul>
      )}
      <p className="mt-3 text-xs text-ink-muted">
        {t`Removed files live in .cadabra/trash inside your book folder. Nothing is deleted for good.`}
      </p>
    </Modal>
  );
}
