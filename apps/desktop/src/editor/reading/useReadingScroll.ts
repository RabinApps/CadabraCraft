import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";

/** The reading line, as a fraction of the viewport height from its top: the chapter and page there is "where the reader is". */
export const READING_LINE = 0.3;
/** Where a found match is put, as a fraction of the viewport height from its top. */
const MATCH_LINE = 0.4;
/** How long a jump keeps correcting itself while the chapter and the ones above it lay out. */
const JUMP_MS = 2500;

/** Where a jump is going: a chapter (its opening page, or `fraction` of the way down it) or the current search match inside it. */
export interface Goal {
  id: string;
  fraction?: number;
  match?: boolean;
}

/**
 * The scroll logic of Read mode's scroller: keeping what the reader is looking at where it was when a section changes height (WebKit has
 * no scroll anchoring), and jumping to a chapter, a place in it or a search match. A jump far away lands on a placeholder: the chapter's
 * pages are not laid out yet, so the scroll is repeated each time that chapter lays out (`realign`) until the reader scrolls on their
 * own or a couple of seconds pass. The chapters above it are kept in place by the height compensation.
 */
export function useReadingScroll(
  scroller: RefObject<HTMLDivElement | null>,
  /** Called when a jump has stopped correcting itself without the reader scrolling: where the reader is can be read again. */
  onSettled?: () => void,
) {
  const settled = useRef(onSettled);
  settled.current = onSettled;
  const pending = useRef<Goal | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [alignTick, setAlignTick] = useState(0);
  // What the reader is looking at, as the section at the top edge and how far below the edge it starts.
  const anchor = useRef<{ el: HTMLElement; offset: number; top: number } | null>(null);
  const capture = useCallback(() => {
    const sc = scroller.current;
    if (!sc) return;
    let el: HTMLElement | undefined;
    for (const e of sc.querySelectorAll<HTMLElement>("[data-reading-id]")) {
      if (el && e.offsetTop > sc.scrollTop) break;
      el = e;
    }
    anchor.current = el
      ? {
          el,
          offset: el.getBoundingClientRect().top - sc.getBoundingClientRect().top,
          top: sc.scrollTop,
        }
      : null;
  }, [scroller]);
  const restore = useCallback(() => {
    const sc = scroller.current;
    const a = anchor.current;
    if (!sc || !a) return;
    // The reader (or an alignment) moved the scroll since: that is the new position, not something to undo.
    if (Math.abs(sc.scrollTop - a.top) > 1) return capture();
    const drift = a.el.getBoundingClientRect().top - sc.getBoundingClientRect().top - a.offset;
    if (Math.abs(drift) < 1) return;
    sc.scrollTop += drift;
    a.top = sc.scrollTop;
  }, [scroller, capture]);
  /** Scrolls to the pending goal of chapter `id` (its opening page, not the blank page before it, when the goal is just the chapter). */
  const align = useCallback(
    (id: string) => {
      const sc = scroller.current;
      const el = sc?.querySelector<HTMLElement>(`[data-reading-id="${CSS.escape(id)}"]`);
      if (!sc || !el) return;
      const goal = pending.current?.id === id ? pending.current : null;
      const scTop = sc.getBoundingClientRect().top;
      const hit = goal?.match ? el.querySelector<HTMLElement>(".search-match-current") : null;
      let top: number;
      if (hit) {
        top = hit.getBoundingClientRect().top - scTop + sc.scrollTop - sc.clientHeight * MATCH_LINE;
      } else if (goal?.fraction) {
        const r = el.getBoundingClientRect();
        top =
          r.top - scTop + sc.scrollTop + goal.fraction * r.height - sc.clientHeight * READING_LINE;
      } else {
        const card = el.querySelector<HTMLElement>(".page-card:not([data-blank])");
        top = card ? card.getBoundingClientRect().top - scTop + sc.scrollTop : el.offsetTop;
        top -= parseFloat(getComputedStyle(sc).paddingTop);
      }
      sc.scrollTop = Math.max(0, top);
      capture();
    },
    [scroller, capture],
  );
  /** Starts a jump: scrolls now, and again as the chapter lays out. */
  const goTo = useCallback(
    (goal: Goal) => {
      pending.current = goal;
      clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        if (pending.current !== goal) return;
        pending.current = null;
        settled.current?.();
      }, JUMP_MS);
      align(goal.id);
    },
    [align],
  );
  /** A chapter has laid out or has just marked its current match: repeat the scroll if a jump to it is under way. */
  const realign = useCallback((id: string) => {
    if (pending.current?.id === id) setAlignTick((t) => t + 1);
  }, []);
  useLayoutEffect(() => {
    if (alignTick && pending.current) align(pending.current.id);
  }, [alignTick, align]);

  useEffect(() => {
    const sc = scroller.current!;
    capture();
    sc.addEventListener("scroll", capture, { passive: true });
    return () => sc.removeEventListener("scroll", capture);
  }, [scroller, capture]);
  // The reader takes over: stop correcting.
  useEffect(() => {
    const sc = scroller.current!;
    const stop = () => {
      pending.current = null;
    };
    const events = ["wheel", "touchmove", "keydown", "pointerdown"] as const;
    events.forEach((e) => sc.addEventListener(e, stop, { passive: true }));
    return () => {
      events.forEach((e) => sc.removeEventListener(e, stop));
      clearTimeout(timer.current);
    };
  }, [scroller]);
  return { pending, restore, capture, goTo, realign };
}
