import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { useLingui } from "@lingui/react/macro";
import { cx } from "../../ui/cx";
import { SIDEBAR_MAX_WIDTH, SIDEBAR_MIN_WIDTH, clampSidebarWidth } from "../../state/layout";

const STEP = 16;

/** The inline direction to grow in: rightwards in a left-to-right book, leftwards in a right-to-left one. */
const growDirection = (el: HTMLElement) => (getComputedStyle(el).direction === "rtl" ? -1 : 1);

/**
 * The divider between the chapter list and the page on desktop. Drag it, or focus it and use the arrow keys, Home and End.
 * It is hidden below `lg`, where the chapter list is a fixed-width sheet.
 */
export function SidebarResizeHandle({
  width,
  onChange,
}: {
  width: number;
  onChange: (width: number) => void;
}) {
  const { t } = useLingui();
  const drag = useRef<{ pointerId: number; x: number; width: number; direction: number } | null>(
    null,
  );
  const [dragging, setDragging] = useState(false);

  // Keep the resize cursor and stop selecting the page while the divider is held.
  useEffect(() => {
    if (!dragging) return;
    const { style } = document.body;
    const cursor = style.cursor;
    const userSelect = style.userSelect;
    style.cursor = "col-resize";
    style.userSelect = "none";
    return () => {
      style.cursor = cursor;
      style.userSelect = userSelect;
    };
  }, [dragging]);

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.focus();
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = {
      pointerId: event.pointerId,
      x: event.clientX,
      width,
      direction: growDirection(event.currentTarget),
    };
    setDragging(true);
  };

  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const started = drag.current;
    if (!started || started.pointerId !== event.pointerId) return;
    onChange(clampSidebarWidth(started.width + (event.clientX - started.x) * started.direction));
  };

  const endDrag = (event: PointerEvent<HTMLDivElement>) => {
    if (drag.current?.pointerId !== event.pointerId) return;
    drag.current = null;
    setDragging(false);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const grow = growDirection(event.currentTarget);
    const next =
      event.key === "ArrowRight"
        ? width + STEP * grow
        : event.key === "ArrowLeft"
          ? width - STEP * grow
          : event.key === "Home"
            ? SIDEBAR_MIN_WIDTH
            : event.key === "End"
              ? SIDEBAR_MAX_WIDTH
              : null;
    if (next === null) return;
    event.preventDefault();
    onChange(clampSidebarWidth(next));
  };

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={t`Resize chapter list`}
      aria-controls="chapters-sidebar"
      aria-valuemin={SIDEBAR_MIN_WIDTH}
      aria-valuemax={SIDEBAR_MAX_WIDTH}
      aria-valuenow={width}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onLostPointerCapture={() => {
        drag.current = null;
        setDragging(false);
      }}
      onKeyDown={onKeyDown}
      style={{ insetInlineEnd: -4 }}
      className="group absolute inset-y-0 z-(--z-float) flex w-2 cursor-col-resize touch-none items-stretch justify-center"
    >
      <span
        aria-hidden
        className={cx(
          "my-1 w-px rounded-full bg-border transition-colors group-hover:bg-accent group-focus-visible:bg-accent",
          dragging && "bg-accent",
        )}
      />
    </div>
  );
}
