import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type MutableRefObject,
  type RefObject,
} from "react";
import { pageAtLine, visibleIndex } from "../../lib/reading/readingBook";
import { attempt } from "../../state/attempt";
import { setReadingPosition, useReadingPosition } from "../../state/view/readingPosition";

/** Chapters within this many px of the viewport (above and below) have a live editor; the rest are placeholders of the same height. */
const PRELOAD_PX = 900;
/** The reading line, as a fraction of the viewport height from its top: the chapter and page there is "where the reader is". */
const LINE = 0.3;
/** The headings of a chapter, in document order (what a Contents entry's heading position counts). */
const HEADINGS = "h1, h2, h3, h4, h5, h6";

type Scroller = RefObject<HTMLDivElement | null>;
export type Pending = { id: string; heading?: number } | null;

/**
 * Keeps what the reader is looking at in place: the section at the top edge and how far below the edge it starts. WebKit has no
 * scroll anchoring, so when a section changes height `restore` puts that section back at the same offset (and does nothing if it
 * did not move). `align` scrolls to a chapter's opening page, or to a heading of it.
 */
export function useScrollAnchor(scroller: Scroller) {
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
  }, [capture, scroller]);
  const align = useCallback(
    (id: string, heading?: number) => {
      const sc = scroller.current;
      const el = sc?.querySelector<HTMLElement>(`[data-reading-id="${CSS.escape(id)}"]`);
      if (!sc || !el) return;
      // A heading of the chapter (a Contents entry for one), once the chapter has an editor; else the chapter's opening page.
      const target =
        heading === undefined
          ? undefined
          : (el.querySelectorAll<HTMLElement>(HEADINGS)[heading] ?? undefined);
      const card = target ?? el.querySelector<HTMLElement>(".page-card:not([data-blank])");
      const top = card
        ? card.getBoundingClientRect().top - sc.getBoundingClientRect().top + sc.scrollTop
        : el.offsetTop;
      sc.scrollTop = Math.max(0, top - parseFloat(getComputedStyle(sc).paddingTop));
      capture();
    },
    [capture, scroller],
  );
  useEffect(() => {
    const sc = scroller.current!;
    capture();
    sc.addEventListener("scroll", capture, { passive: true });
    return () => sc.removeEventListener("scroll", capture);
  }, [capture, scroller]);
  return { capture, restore, align };
}

/** Which chapters are near the viewport (and so have an editor), and the last measured height of each. */
export function useNearChapters(scroller: Scroller, initialId: string, layoutSig: string) {
  const [near, setNear] = useState<Set<string>>(() => new Set([initialId]));
  const [observer, setObserver] = useState<IntersectionObserver | null>(null);
  const heights = useRef(new Map<string, number>());
  useLayoutEffect(() => {
    const obs = new IntersectionObserver(
      (entries) =>
        setNear((prev) => {
          const next = new Set(prev);
          for (const e of entries) {
            const id = (e.target as HTMLElement).dataset.readingId!;
            if (e.isIntersecting) next.add(id);
            else next.delete(id);
          }
          return next.size === prev.size && [...next].every((id) => prev.has(id)) ? prev : next;
        }),
      { root: scroller.current, rootMargin: `${PRELOAD_PX}px 0px` },
    );
    setObserver(obs);
    return () => obs.disconnect();
  }, [scroller]);
  useLayoutEffect(() => {
    heights.current.clear();
  }, [layoutSig]);
  return { near, observer, heights };
}

interface MeasureInput {
  scroller: Scroller;
  paged: boolean;
  ready: boolean;
  folioFor: (physical: number) => string;
  visible: MutableRefObject<string | null>;
  /** Which sections have laid out, and the book layout: when they change the page numbers move. */
  laid: ReadonlySet<string>;
  layout: unknown;
}

/** Where the reader is: the chapter (and page) at the reading line, from the scroll position. */
export function useReadingMeasure(input: MeasureInput) {
  const { scroller, paged, ready, folioFor, visible, laid, layout } = input;
  const measure = useCallback(() => {
    const sc = scroller.current;
    if (!sc || !ready) return;
    const els = Array.from(sc.querySelectorAll<HTMLElement>("[data-reading-id]"));
    const atEnd = sc.scrollTop > 0 && sc.scrollTop + sc.clientHeight >= sc.scrollHeight - 2;
    const at = visibleIndex(
      els.map((e) => e.offsetTop),
      sc.scrollTop + sc.clientHeight * LINE,
      atEnd,
    );
    const el = els[at];
    if (!el) return;
    const lineY = sc.getBoundingClientRect().top + sc.clientHeight * LINE;
    const cards = paged
      ? Array.from(el.querySelectorAll<HTMLElement>(".page-card")).map((c) => ({
          top: c.getBoundingClientRect().top,
          number: Number(c.dataset.physical),
        }))
      : [];
    visible.current = el.dataset.readingId!;
    // The footer names the page as the PDF prints it (roman in the front matter, arabic later), not its position in the book.
    const line = pageAtLine(cards, lineY);
    setReadingPosition(visible.current, line === null ? null : folioFor(line));
  }, [scroller, paged, ready, folioFor, visible]);
  useEffect(() => {
    const sc = scroller.current!;
    let raf = 0;
    const on = () => {
      if (!raf)
        raf = requestAnimationFrame(() => {
          raf = 0;
          measure();
        });
    };
    sc.addEventListener("scroll", on, { passive: true });
    on();
    return () => {
      sc.removeEventListener("scroll", on);
      cancelAnimationFrame(raf);
    };
  }, [measure, scroller]);
  // Page numbers and counts settle after the editors lay out: read the position again.
  useEffect(() => {
    const raf = requestAnimationFrame(measure);
    return () => cancelAnimationFrame(raf);
  }, [measure, laid, layout]);
  useEffect(() => () => setReadingPosition(null, null), []);
  return measure;
}

interface JumpInput {
  scroller: Scroller;
  currentId: string | null;
  ready: boolean;
  selectChapter: (id: string) => Promise<unknown>;
  align: (id: string, heading?: number) => void;
  measure: () => void;
  visible: MutableRefObject<string | null>;
}

/**
 * The open chapter follows the reader (after a pause, so scrolling does not reload it at every chapter boundary), and a chapter
 * chosen elsewhere (the sidebar, Previous and Next, a Contents entry) is scrolled to: to its opening page, not the blank page
 * before it. Its pages are not laid out yet when it was far away, so the scroll is repeated as it settles, until the reader scrolls
 * on their own (or a couple of seconds pass).
 */
export function useChapterJumps(input: JumpInput) {
  const { scroller, currentId, ready, selectChapter, align, measure, visible } = input;
  const pending = useRef<Pending>(null);
  const echo = useRef<string | null>(null);
  const [alignTick, setAlignTick] = useState(0);
  const jump = useRef<{ id: string; heading?: number } | null>(null);
  const [jumpTick, setJumpTick] = useState(0);

  // The open chapter follows the reader ...
  const position = useReadingPosition((s) => s.id);
  useEffect(() => {
    if (!position || position === currentId) return;
    const timer = setTimeout(() => {
      echo.current = position;
      attempt(selectChapter(position));
    }, 250);
    return () => clearTimeout(timer);
  }, [position, currentId, selectChapter]);
  // ... and the reader scrolling on their own ends a pending jump.
  useEffect(() => {
    const sc = scroller.current!;
    const stop = () => {
      pending.current = null;
    };
    const events = ["wheel", "touchmove", "keydown", "pointerdown"] as const;
    events.forEach((e) => sc.addEventListener(e, stop, { passive: true }));
    return () => events.forEach((e) => sc.removeEventListener(e, stop));
  }, [scroller]);
  // `align` and `measure` are new functions whenever the book layout is (a section measured), so the effects below read the
  // latest through refs: re-running a jump because a page count arrived would scroll the reader back while they read.
  const alignNow = useRef(align);
  alignNow.current = align;
  const measureNow = useRef(measure);
  measureNow.current = measure;
  /** Scrolls to the chapter now and keeps doing so as it lays out, for a couple of seconds. */
  const startJump = useCallback((id: string, heading: number | undefined) => {
    const mine = { id, heading };
    pending.current = mine;
    alignNow.current(id, heading);
    measureNow.current();
    const timer = setTimeout(() => {
      if (pending.current === mine) pending.current = null;
    }, 2500);
    return () => clearTimeout(timer);
  }, []);
  useLayoutEffect(() => {
    if (!currentId || !ready) return;
    if (echo.current === currentId) {
      echo.current = null;
      return;
    }
    if (visible.current === currentId) return;
    // A Contents entry for a heading of this chapter asked for it: keep the heading to scroll to.
    const asked = jump.current?.id === currentId ? jump.current.heading : undefined;
    // The layout changing (a section measured) makes `align` and `measure` new functions; they are read through refs so this
    // effect runs only when the open chapter changes, never while the reader is scrolling.
    return startJump(currentId, asked);
  }, [currentId, ready, startJump, visible]);
  // Only a section of the pending chapter finishing its layout asks for the jump again: `align` is a new function whenever the
  // book layout is, and aligning again then would scroll the reader back to the chapter they came from.
  useLayoutEffect(() => {
    if (alignTick && pending.current) alignNow.current(pending.current.id, pending.current.heading);
  }, [alignTick]);
  // An entry of the Contents page was chosen: open that chapter and scroll to it (or to its heading), also when it is already the
  // open one or is on screen, which the effect above would leave where it is.
  const open = useCallback(
    (id: string, heading?: number) => {
      jump.current = { id, heading };
      setJumpTick((n) => n + 1);
      attempt(selectChapter(id));
    },
    [selectChapter],
  );
  useLayoutEffect(() => {
    const j = jump.current;
    if (!jumpTick || !j || !ready) return;
    // Read through refs, so a chapter that lays out (a new layout, and so new `align` and `measure`) does not re-run the jump:
    // that would send the reader back to the last Contents link they followed, over a chapter they chose since.
    return startJump(j.id, j.heading);
  }, [jumpTick, ready, startJump]);
  /** A section laid out its pages: if it is the chapter being scrolled to, scroll again. */
  const sectionLaidOut = useCallback((id: string) => {
    if (pending.current?.id === id) setAlignTick((n) => n + 1);
  }, []);
  return { open, sectionLaidOut };
}
