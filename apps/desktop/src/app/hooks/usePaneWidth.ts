import { useLayoutEffect, useState, type RefObject } from "react";

/** The client width of a scroller, kept current as the pane is resized (0 until it is measured). Used to fit the pages to the pane. */
export function usePaneWidth(ref: RefObject<HTMLElement | null>): number {
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const read = () => setWidth(Math.round(el.clientWidth));
    read();
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return width;
}
