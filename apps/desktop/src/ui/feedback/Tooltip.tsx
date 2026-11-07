import * as T from "@radix-ui/react-tooltip";
import type { ReactElement, ReactNode } from "react";

interface Props {
  /** What the tooltip says; the trigger keeps its own accessible name. */
  content: ReactNode;
  /** The one focusable element the tooltip describes (it must forward its ref and props). */
  children: ReactElement;
}

/** Keys that move focus by keyboard; a focus that did not follow one (a dialog's first button, a click) shows no tooltip. */
const FOCUS_KEYS = new Set([
  "Tab",
  "ArrowLeft",
  "ArrowRight",
  "ArrowUp",
  "ArrowDown",
  "Home",
  "End",
]);
let focusedByKeyboard = false;
let listening = false;
function listen() {
  if (listening || typeof document === "undefined") return;
  listening = true;
  document.addEventListener("keydown", (e) => (focusedByKeyboard = FOCUS_KEYS.has(e.key)), true);
  document.addEventListener("pointerdown", () => (focusedByKeyboard = false), true);
}

/**
 * WCAG 1.4.13 content on hover or focus: opens on pointer hover and on keyboard focus, stays while the pointer
 * is over it (hoverable), and Esc closes it (dismissible). No animation, so reduced motion needs no special case.
 * A dialog that puts focus on its first button (Close viewer) shows no tooltip there, so its first Escape closes the dialog
 * and not a tooltip nobody asked for.
 */
export function Tooltip({ content, children }: Props) {
  listen();
  return (
    <T.Provider delayDuration={400} skipDelayDuration={200}>
      <T.Root>
        <T.Trigger
          asChild
          onFocus={(e) => {
            // Radix skips its own opening when the event is default-prevented.
            if (!focusedByKeyboard) e.preventDefault();
          }}
        >
          {children}
        </T.Trigger>
        <T.Portal>
          <T.Content
            side="top"
            sideOffset={6}
            collisionPadding={8}
            className="z-[100] max-w-xs rounded-md border border-border-strong bg-surface px-2.5 py-1.5 text-small text-ink shadow-page"
          >
            {content}
          </T.Content>
        </T.Portal>
      </T.Root>
    </T.Provider>
  );
}
