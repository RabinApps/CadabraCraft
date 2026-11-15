import * as D from "@radix-ui/react-dialog";
import { useLingui } from "@lingui/react/macro";
import { useRef, type FocusEvent, type ReactNode } from "react";
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

/**
 * The element focus should return to when a dialog opened from where `active` has focus is closed. A dialog opened by a
 * menu item would otherwise remember the item, which is gone once the menu closes; the menu's trigger is the opener then.
 */
export function openerOf(active: Element | null): HTMLElement | null {
  if (!(active instanceof HTMLElement)) return null;
  const triggerId = active.closest("[role=menu]")?.getAttribute("aria-labelledby");
  const trigger = triggerId ? document.getElementById(triggerId) : null;
  return trigger ?? active;
}

/**
 * Safari and WKWebView on macOS do not focus a button when it is clicked: `document.activeElement` is then the body or
 * the nearest focusable ancestor (the `main` landmark), not the button. So the control pressed a moment ago, if the
 * last input was a click, stands in for the focused one.
 */
const PRESSABLE = "button, a[href], [role=button], [role=menuitem], summary";
let lastPress: { el: Element; at: number } | null = null;
if (typeof document !== "undefined") {
  document.addEventListener(
    "pointerdown",
    (e) => {
      const el = e.target instanceof Element ? e.target.closest(PRESSABLE) : null;
      lastPress = el ? { el, at: Date.now() } : null;
    },
    true,
  );
  document.addEventListener(
    "keydown",
    () => {
      lastPress = null;
    },
    true,
  );
}

/**
 * What has focus, except when that is the body or a container of the control a click just pressed (the engine's stand-in
 * for the unfocused button). A control that keeps focus elsewhere on purpose, like the editor, stays the answer.
 */
export function activeOrPressed(): Element | null {
  const active = document.activeElement;
  if (!lastPress || !lastPress.el.isConnected || Date.now() - lastPress.at >= 1000) return active;
  return !active || active === document.body || active.contains(lastPress.el)
    ? lastPress.el
    : active;
}

export type ModalSize = "sm" | "md" | "wide" | "xl" | "full";

// A dialog taller than the window scrolls; a classic scrollbar would take room on the right only and push the content
// off centre, so the same room is kept on the left.
const scrolls = "overflow-y-auto [scrollbar-gutter:stable_both-edges]";

const sizeClass: Record<ModalSize, string> = {
  sm: `max-h-[92dvh] w-[min(92vw,460px)] ${scrolls}`,
  md: `max-h-[92dvh] w-[min(92vw,560px)] ${scrolls}`,
  wide: `max-h-[92dvh] w-[min(92vw,680px)] ${scrolls}`,
  xl: `max-h-[92dvh] w-[min(94vw,860px)] ${scrolls}`,
  full: `max-h-[92dvh] w-[min(96vw,1120px)] ${scrolls}`,
};

export const overlayClass = "motion-overlay fixed inset-0 z-(--z-overlay) bg-scrim";
export const panelClass =
  "motion-panel fixed z-(--z-dialog) border border-border bg-raised text-ink shadow-dialog focus:outline-none";

/**
 * Dialogs are controlled and have no Radix Trigger, so remember the opener and give focus back to it (WCAG 2.4.3).
 * It is read while rendering, before a field with autoFocus can take focus. Pass the result to `onCloseAutoFocus`.
 */
export function useFocusReturn(open: boolean): (e: Event) => void {
  const opener = useRef<HTMLElement | null>(null);
  const caret = useRef<Caret | null>(null);
  const wasOpen = useRef(false);
  if (open && !wasOpen.current) {
    opener.current = openerOf(activeOrPressed());
    caret.current = editableCaret(opener.current);
  }
  wasOpen.current = open;
  return (e) => {
    const back = opener.current;
    const saved = caret.current;
    opener.current = caret.current = null;
    if (back?.isConnected && back !== document.body) {
      e.preventDefault();
      // The editor may already have taken focus back with its own selection; focusing it again would reset the caret in WebKit.
      if (back.contains(document.activeElement)) return;
      back.focus();
      restoreCaret(saved);
    }
  };
}

interface Caret {
  anchor: Node;
  anchorOffset: number;
  focus: Node;
  focusOffset: number;
}

/**
 * The selection inside an editable opener (the editor), as plain values: WebKit puts the caret at the start when focus()
 * returns to it. A live Range would not do, because the DOM shifts it when the editor re-renders its text.
 */
function editableCaret(opener: HTMLElement | null): Caret | null {
  const sel = document.getSelection();
  if (!opener?.isContentEditable || !sel?.anchorNode || !sel.focusNode) return null;
  if (!opener.contains(sel.anchorNode) || !opener.contains(sel.focusNode)) return null;
  const { anchorNode: anchor, anchorOffset, focusNode: focus, focusOffset } = sel;
  return { anchor, anchorOffset, focus, focusOffset };
}

/** Puts the caret back unless the editor replaced the nodes it pointed into; it then has its own selection to show. */
function restoreCaret(caret: Caret | null) {
  if (!caret?.anchor.isConnected || !caret.focus.isConnected) return;
  document
    .getSelection()
    ?.setBaseAndExtent(caret.anchor, caret.anchorOffset, caret.focus, caret.focusOffset);
}

/**
 * Radix moves focus inside the dialog without scrolling (`preventScroll`), so when Tab wraps from the last control to the first
 * in a dialog that scrolls, the focused control stays out of view (WCAG 2.4.11). Bring it into view, doing nothing when it is.
 */
export const keepFocusInView = (e: FocusEvent<HTMLElement>) => {
  if (e.target instanceof HTMLElement) e.target.scrollIntoView({ block: "nearest" });
};

export function Modal({
  open,
  onOpenChange,
  title,
  description,
  children,
  size = "sm",
}: ModalProps) {
  const onCloseAutoFocus = useFocusReturn(open);
  return (
    <D.Root open={open} onOpenChange={onOpenChange}>
      <D.Portal>
        <D.Overlay className={overlayClass} />
        <D.Content
          onCloseAutoFocus={onCloseAutoFocus}
          onFocus={keepFocusInView}
          // A field marked data-own-escape (inline rename) uses Escape to cancel itself; the dialog stays open.
          onEscapeKeyDown={(e) => {
            if (e.target instanceof Element && e.target.closest("[data-own-escape]"))
              e.preventDefault();
          }}
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
