import * as D from "@radix-ui/react-dialog";
import { useLingui } from "@lingui/react/macro";
import type { ReactNode } from "react";
import { Button } from "./Button";
import { cx } from "./cx";

interface ModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  children?: ReactNode;
  /**
   * Width: `sm` 460px (default), `md` 560px (Export dialog, as in the pen), `wide` about 680px (two-column forms) or
   * `xl` about 860px (side-by-side layouts such as History). Everything above `sm` scrolls inside the viewport.
   */
  size?: ModalSize;
}

export type ModalSize = "sm" | "md" | "wide" | "xl" | "full";

const sizeClass: Record<ModalSize, string> = {
  sm: "w-[min(92vw,460px)]",
  md: "max-h-[92dvh] w-[min(92vw,560px)] overflow-y-auto",
  wide: "max-h-[92dvh] w-[min(92vw,680px)] overflow-y-auto",
  xl: "max-h-[92dvh] w-[min(94vw,860px)] overflow-y-auto",
  full: "max-h-[92dvh] w-[min(96vw,1120px)] overflow-y-auto",
};

export const overlayClass = "motion-overlay fixed inset-0 z-(--z-overlay) bg-scrim";
export const panelClass =
  "motion-panel fixed z-(--z-dialog) border border-border bg-raised text-ink shadow-dialog focus:outline-none";

export function Modal({
  open,
  onOpenChange,
  title,
  description,
  children,
  size = "sm",
}: ModalProps) {
  return (
    <D.Root open={open} onOpenChange={onOpenChange}>
      <D.Portal>
        <D.Overlay className={overlayClass} />
        <D.Content
          {...(description ? {} : { "aria-describedby": undefined })}
          className={cx(
            panelClass,
            "left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-lg p-6",
            sizeClass[size],
          )}
        >
          <D.Title className="font-book text-title font-semibold">{title}</D.Title>
          {description ? (
            <D.Description className="mt-2 text-sm text-ink-muted">{description}</D.Description>
          ) : null}
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
  onConfirm: () => void;
}

/** A confirmation for a destructive action: the confirm button is the danger style. */
export function Confirm({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  onConfirm,
}: ConfirmProps) {
  const { t } = useLingui();
  return (
    <Modal open={open} onOpenChange={onOpenChange} title={title} description={description}>
      <div className="flex justify-end gap-2.5">
        <Button onClick={() => onOpenChange(false)}>{t`Cancel`}</Button>
        <Button
          variant="danger"
          onClick={() => {
            onOpenChange(false);
            onConfirm();
          }}
        >
          {confirmLabel}
        </Button>
      </div>
    </Modal>
  );
}
