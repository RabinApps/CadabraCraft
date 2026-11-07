import { cx } from "./cx";

/** The line that shows where a dragged entry will land, drawn in the gap above (or below) a row so the list does not move. */
export function DropLine({ below }: { below?: boolean }) {
  return (
    <span
      aria-hidden
      data-drop-line
      className={cx(
        "pointer-events-none absolute inset-x-0 h-0.75 rounded-full bg-accent forced-colors:bg-[Highlight]",
        below ? "bottom-[-5.5px]" : "top-[-5.5px]",
      )}
    >
      <span className="absolute -inset-s-1 -top-0.75 size-2.25 rounded-full bg-accent forced-colors:bg-[Highlight]" />
    </span>
  );
}
