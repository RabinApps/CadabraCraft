import * as D from "@radix-ui/react-dialog";
import { useLingui } from "@lingui/react/macro";
import type { ReactNode } from "react";
import { Button } from "./Button";

interface ModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  children?: ReactNode;
}

export const overlayClass = "fixed inset-0 z-40 bg-scrim";
export const panelClass = "fixed z-50 border border-border bg-raised text-ink shadow-2xl focus:outline-none";

export function Modal({ open, onOpenChange, title, description, children }: ModalProps) {
  return (
    <D.Root open={open} onOpenChange={onOpenChange}>
      <D.Portal>
        <D.Overlay className={overlayClass} />
        <D.Content
          {...(description ? {} : { "aria-describedby": undefined })}
          className={`${panelClass} left-1/2 top-1/2 w-[min(92vw,460px)] -translate-x-1/2 -translate-y-1/2 rounded-lg p-6`}
        >
          <D.Title className="font-book text-xl font-semibold">{title}</D.Title>
          {description ? <D.Description className="mt-2 text-sm text-ink-muted">{description}</D.Description> : null}
          <div className="mt-4">{children}</div>
        </D.Content>
      </D.Portal>
    </D.Root>
  );
}

interface ConfirmProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  confirmLabel: string;
  danger?: boolean;
  onConfirm: () => void;
}

export function Confirm({ open, onOpenChange, title, description, confirmLabel, danger, onConfirm }: ConfirmProps) {
  const { t } = useLingui();
  return (
    <Modal open={open} onOpenChange={onOpenChange} title={title} description={description}>
      <div className="flex justify-end gap-2.5">
        <Button onClick={() => onOpenChange(false)}>{t`Cancel`}</Button>
        <Button variant={danger ? "danger" : "primary"} onClick={() => { onOpenChange(false); onConfirm(); }}>{confirmLabel}</Button>
      </div>
    </Modal>
  );
}
