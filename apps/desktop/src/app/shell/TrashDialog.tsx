import { useEffect, useState } from "react";
import { useLingui } from "@lingui/react/macro";
import { Undo2 } from "lucide-react";
import { Modal } from "../../ui/Dialog";
import { Button } from "../../ui/Button";
import { useProject } from "../../state/project/index";
import { causeText } from "../../lib/projectError";

export function TrashDialog({
  open,
  onOpenChange,
  onNavigate,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onNavigate?: () => void;
}) {
  const { t } = useLingui();
  const trash = useProject((s) => s.trash);
  const actions = useProject((s) => s.actions);
  const [error, setError] = useState("");
  /** The page whose restore failed, so its button is described by the error. */
  const [failed, setFailed] = useState<string | null>(null);
  useEffect(() => {
    if (!open) return;
    setError("");
    setFailed(null);
    actions
      .refreshTrash()
      .catch((e) =>
        setError(
          t`Could not read the trash (${causeText(e)}). Close this dialog and open the trash again to retry.`,
        ),
      );
  }, [open, actions]);
  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={t`Trash`}
      description={t`Pages you moved to the trash. Restoring puts a page back at the end of its section.`}
    >
      {error && (
        <p id="trash-error" role="alert" className="mb-2 text-sm text-danger">
          {error}
        </p>
      )}
      {trash.length === 0 ? (
        <p className="text-sm text-ink-muted">{t`The trash is empty.`}</p>
      ) : (
        <ul className="m-0 flex max-h-72 list-none flex-col gap-1 overflow-y-auto p-0">
          {trash.map((x) => (
            <li key={x.path} className="flex items-center gap-2">
              <span className="min-w-0 flex-1 truncate text-sm text-ink">{x.title}</span>
              <Button
                icon={Undo2}
                aria-label={t`Restore ${x.title}`}
                aria-describedby={error && failed === x.path ? "trash-error" : undefined}
                onClick={() => {
                  setError("");
                  setFailed(null);
                  void actions.restoreTrash(x.path).then(
                    () => {
                      onOpenChange(false);
                      onNavigate?.();
                    },
                    (e) => {
                      setFailed(x.path);
                      setError(
                        t`Could not restore ${x.title} (${causeText(e)}). It is still in the trash. Try again, or restore another page.`,
                      );
                    },
                  );
                }}
              >
                {t`Restore`}
              </Button>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}
