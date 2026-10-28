import { useLingui } from "@lingui/react/macro";
import { History } from "lucide-react";
import { Modal } from "../../ui/Dialog";
import { Button } from "../../ui/Button";
import { errText } from "../../lib/projectError";
import { useProject } from "../../state/project/index";
import { useState } from "react";

/** Offered when a book opens and a page's newest snapshot is newer than the saved page (for example a sync folder put an older file back). One page at a time. */
export function RecoverDialog() {
  const { t } = useLingui();
  const next = useProject((s) => s.recovery[0]);
  const actions = useProject((s) => s.actions);
  const [error, setError] = useState("");
  if (!next) return null;
  const keep = () => {
    setError("");
    actions.dismissRecovery(next.id);
  };
  return (
    <Modal
      open
      onOpenChange={(o) => {
        if (!o) keep();
      }}
      title={t`Recover newer text for “${next.title}”?`}
      description={t`A newer version of this page was found in History than the one saved in your book, for example after a sync folder put an older file back. Your saved text is kept as a snapshot either way.`}
    >
      {error && (
        <p role="alert" className="mb-3 text-sm text-danger">
          {error}
        </p>
      )}
      <div className="flex justify-end gap-2.5">
        <Button onClick={keep}>{t`Keep saved text`}</Button>
        <Button
          variant="primary"
          icon={History}
          onClick={() => {
            setError("");
            void actions.restoreSnapshot(next.id, next.snapshot).catch((e) => setError(errText(e)));
          }}
        >{t`Use newer text`}</Button>
      </div>
    </Modal>
  );
}
