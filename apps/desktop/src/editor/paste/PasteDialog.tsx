import { useLingui } from "@lingui/react/macro";
import { WandSparkles } from "lucide-react";
import { Modal } from "../../ui/Dialog";
import { Button } from "../../ui/Button";
import { Checkbox } from "../../ui/forms/Checkbox";
import { truncate } from "./htmlPaste";
import type { PendingPaste } from "./pasteFlow";

/** Asks whether pasted text that holds HTML tags becomes real formatting or stays as text. */
export function PasteDialog(props: {
  pending: PendingPaste | null;
  remember: boolean;
  onRemember: (on: boolean) => void;
  onAnswer: (convert: boolean) => void;
  onClose: () => void;
}) {
  const { t } = useLingui();
  const { pending } = props;
  return (
    <Modal
      open={pending !== null}
      onOpenChange={props.onClose}
      title={t`Paste as styled text?`}
      description={t`The text you pasted contains HTML tags. CadabraCraft can turn them into real formatting, or keep the tags as plain text.`}
    >
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-3 rounded-md border border-border bg-paper p-3">
          <div className="min-w-0">
            <p className="text-xs font-semibold text-ink-muted">{t`What you pasted`}</p>
            <p className="mt-1 break-words font-mono text-xs text-ink" data-testid="paste-source">
              {truncate(pending?.text ?? "")}
            </p>
          </div>
          <div className="min-w-0">
            <p className="text-xs font-semibold text-ink-muted">{t`Becomes`}</p>
            <p className="mt-1 break-words text-sm text-ink" data-testid="paste-result">
              {pending?.converted.preview}
            </p>
          </div>
        </div>
        <Checkbox
          label={t`Remember my choice`}
          hint={t`You can change this later in Settings, Editor.`}
          checked={props.remember}
          onChange={(e) => props.onRemember(e.target.checked)}
        />
        <div className="flex justify-end gap-2.5">
          <Button onClick={() => props.onAnswer(false)}>{t`Keep as text`}</Button>
          <Button
            variant="primary"
            icon={WandSparkles}
            onClick={() => props.onAnswer(true)}
            autoFocus
          >{t`Convert`}</Button>
        </div>
      </div>
    </Modal>
  );
}
