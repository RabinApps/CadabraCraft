import { cx } from "./cx";

/** Class for a Radix dropdown-menu content panel; `min-w-*` and other sizing go in `extra`. */
export const menuContentClass = (extra?: string | false) =>
  cx(
    "motion-panel z-(--z-menu) rounded-md border border-border bg-raised p-1 text-ink shadow-popover",
    extra,
  );

/** Class for a Radix dropdown-menu item. */
export const menuItemClass = (extra?: string | false) =>
  cx(
    "flex cursor-default items-center gap-2 rounded-sm px-2.5 py-2 text-sm text-ink outline-none data-[disabled]:opacity-40 data-[highlighted]:bg-accent-soft data-[highlighted]:outline-2 data-[highlighted]:-outline-offset-2 data-[highlighted]:outline-accent",
    extra,
  );

/** Class for a Radix dropdown-menu group label. */
export const menuLabelClass =
  "px-2.5 py-1 text-micro font-bold uppercase tracking-[0.12em] text-ink-muted";
