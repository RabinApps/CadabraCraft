import { useLayoutEffect, useState, type RefObject } from "react";
import type { Editor as TipTapEditor } from "@tiptap/react";
import { useSettings } from "../state/view/editorPrefs";
import { typewriterSlack, typewriterTarget } from "../lib/reading/typewriterScroll";

/** How long after a key a selection change still counts as the key's (a click or a find jump comes without one). */
export const KEY_WINDOW_MS = 250;

/** Puts the caret's line in the middle of the scroller that holds the editor. See architecture.md, "Typewriter mode". */
function centerCaret(editor: TipTapEditor): void {
  if (editor.isDestroyed || editor.view.composing) return;
  const scroller = editor.view.dom.closest<HTMLElement>(".overflow-y-auto");
  if (!scroller) return;
  let caret;
  try {
    caret = editor.view.coordsAtPos(editor.state.selection.head);
  } catch {
    return; // the position is not drawn (yet)
  }
  const box = scroller.getBoundingClientRect();
  // A phone's on-screen keyboard covers the lower part of the scroller: the middle is that of what is left.
  const vv = window.visualViewport;
  const bottom = vv ? Math.min(box.bottom, vv.offsetTop + vv.height) : box.bottom;
  const top = typewriterTarget({
    caret,
    view: { top: box.top, bottom },
    scrollTop: scroller.scrollTop,
    maxScrollTop: scroller.scrollHeight - scroller.clientHeight,
  });
  // Instant, never animated: a smooth scroll restarts on every key and lags behind fast typing, and there is then no motion to
  // switch off under `prefers-reduced-motion` (WCAG 2.3.3).
  if (top !== null) scroller.scrollTo({ top, behavior: "instant" });
}

let frame = 0;
/** Follows the caret once the pagination has settled the layout; a newer call replaces an older one. */
export function followCaret(editor: TipTapEditor): void {
  cancelAnimationFrame(frame);
  frame = requestAnimationFrame(() => centerCaret(editor));
}

/**
 * Bottom padding in px for a scroller while typewriter scrolling is on (half its height, so the last line can reach the middle),
 * else 0. Kept current as the pane is resized.
 */
export function useTypewriterSlack(ref: RefObject<HTMLElement | null>): number {
  const on = useSettings((s) => s.typewriterScroll);
  const [slack, setSlack] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!on || !el) return setSlack(0);
    const read = () => setSlack(typewriterSlack(el.clientHeight));
    read();
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, [on, ref]);
  return slack;
}

/**
 * Puts the caret's line back in the middle when the pages change height under it (Typst's exact page breaks arriving, a zoom or a
 * font change): without it the line the author is writing on drifts away until the next key. Only while the editor has focus, so a
 * layout that settles while the author reads elsewhere moves nothing.
 */
export function useTypewriterRefollow(
  ref: RefObject<HTMLElement | null>,
  editor: TipTapEditor | null,
): void {
  const on = useSettings((s) => s.typewriterScroll);
  useLayoutEffect(() => {
    const content = ref.current?.firstElementChild;
    if (!on || !editor || !content) return;
    let first = true;
    const ro = new ResizeObserver(() => {
      // The observer reports once when it starts; that is not a change.
      if (first) return void (first = false);
      if (!editor.isDestroyed && editor.isFocused) followCaret(editor);
    });
    ro.observe(content);
    return () => ro.disconnect();
  }, [on, editor, ref]);
}
