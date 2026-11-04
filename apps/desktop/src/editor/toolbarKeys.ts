import type { KeyboardEvent } from "react";

/**
 * Arrow keys, Home and End move the focus between the enabled buttons of a toolbar (the WAI-ARIA toolbar pattern), wrapping
 * at the ends. Left and Right swap in a right-to-left bar. Keys from inside a menu opened from the bar are not its own.
 */
export function moveInToolbar(e: KeyboardEvent<HTMLElement>, bar: HTMLElement | null) {
  if (!bar) return;
  const buttons = Array.from(bar.querySelectorAll<HTMLButtonElement>("button:not(:disabled)"));
  const at = buttons.indexOf(document.activeElement as HTMLButtonElement);
  if (at < 0) return;
  const rtl = getComputedStyle(bar).direction === "rtl";
  const to =
    e.key === "ArrowRight"
      ? at + (rtl ? -1 : 1)
      : e.key === "ArrowLeft"
        ? at + (rtl ? 1 : -1)
        : e.key === "Home"
          ? 0
          : e.key === "End"
            ? buttons.length - 1
            : null;
  if (to === null) return;
  e.preventDefault();
  buttons[(to + buttons.length) % buttons.length]?.focus();
}
