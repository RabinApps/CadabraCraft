import { useEffect, useMemo, useRef, useState, type RefObject, type WheelEvent } from "react";
import { readingOrder } from "@cadabracraft/format";
import { useProject } from "../state/project/index";
import { attempt } from "../state/attempt";
import {
  edgeStep,
  requestLanding,
  sectionNeighbours,
  takeLanding,
  type Landing,
} from "../lib/reading/sectionScroll";

/**
 * Keeps scrolling in Write mode going: past the last page of the open section the next one opens, and above its first page the one
 * before (see `lib/sectionScroll.ts`). The frame mounts again for the new section, so the landing it is opened to (its start when
 * coming from above, its end when coming from below) is read once here and applied as the pages settle.
 */
export function useSectionScroll(scroller: RefObject<HTMLDivElement | null>) {
  const manifest = useProject((s) => s.manifest);
  const currentId = useProject((s) => s.currentId);
  const selectChapter = useProject((s) => s.actions.selectChapter);
  const ids = useMemo(() => (manifest ? readingOrder(manifest).map((e) => e.id) : []), [manifest]);
  const neighbours = useMemo(() => sectionNeighbours(ids, currentId), [ids, currentId]);
  const travel = useRef(0);
  const [landing] = useState<Landing>(takeLanding);
  /** Set once the end has been reached (or the author scrolled), so the chase below never fights them. */
  const settled = useRef(landing !== "end");

  // Opened from below: the previous section shows its last page, so the two read as one document. Its pages are laid out over the
  // next frames (Typst's breaks arrive after the estimate), so the bottom is followed while the stack still grows.
  useEffect(() => {
    if (landing !== "end") return;
    let frame = 0;
    let tries = 0;
    let height = -1;
    const place = () => {
      const el = scroller.current;
      if (!el || settled.current) return;
      if (el.scrollHeight > el.clientHeight + 2 && el.scrollHeight !== height) {
        el.scrollTop = el.scrollHeight;
        height = el.scrollHeight;
      }
      if (++tries < 60) frame = requestAnimationFrame(place);
    };
    frame = requestAnimationFrame(place);
    return () => cancelAnimationFrame(frame);
  }, [landing, scroller]);

  const onWheel = (e: WheelEvent<HTMLElement>) => {
    const el = scroller.current;
    if (!el) return;
    const step = edgeStep({
      travel: travel.current,
      deltaY: e.deltaY,
      deltaMode: e.deltaMode,
      scrollTop: el.scrollTop,
      scrollHeight: el.scrollHeight,
      clientHeight: el.clientHeight,
    });
    travel.current = step.travel;
    if (!step.intent) return;
    // The author has taken over: a landing that has not happened yet would jump the page under them.
    settled.current = true;
    const target = step.intent === "next" ? neighbours.next : neighbours.prev;
    if (!target) return;
    requestLanding(step.intent === "next" ? "start" : "end");
    attempt(selectChapter(target));
  };

  return { onWheel };
}
