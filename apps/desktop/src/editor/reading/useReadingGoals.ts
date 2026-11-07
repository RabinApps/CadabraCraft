import { useCallback, useEffect, useLayoutEffect, useRef } from "react";
import { locate, type Hit } from "../../lib/search/readFind";
import { useReadFind } from "../../state/view/readFind";
import {
  flushReadingPosition,
  rememberReadingPosition,
  takeSavedPosition,
  type SavedPosition,
} from "../../state/view/readingMemory";
import type { Goal } from "./useReadingScroll";

/**
 * Remembers where the reader is, per book (`state/view/readingMemory.ts`). While a jump is under way the scroll is not the reader's
 * yet, so the place to remember is where they are going: `jumping` is set by the jumps once they exist.
 */
export function useRememberPosition(
  root: string | null,
  currentId: string | null,
  pages: readonly { id: string }[],
) {
  // The first time a book is read in a session it resumes where it was left.
  const resume = useRef(
    takeSavedPosition(
      root,
      currentId,
      pages.map((p) => p.id),
    ),
  );
  const jumping = useRef<() => boolean>(() => false);
  const remember = useCallback(
    (id: string, fraction: number) => {
      if (root && !jumping.current()) rememberReadingPosition(root, id, fraction);
    },
    [root],
  );
  useEffect(() => flushReadingPosition, []);
  return { remember, jumping, resume };
}

/**
 * Jumps the reader makes on their own: to the place the book was left at (once, when the pane has a size), and to the current match
 * of the find bar each time it moves (`useReadFind().tick`).
 */
export function useReadingGoals(input: {
  ready: boolean;
  jumps: { goTo: (id: string, goal?: Goal) => void; jumping: () => boolean };
  jumping: { current: () => boolean };
  hits: readonly Hit[];
  resume: { current: SavedPosition | null };
}) {
  const { ready, jumps, jumping, hits, resume } = input;
  const { goTo } = jumps;
  jumping.current = jumps.jumping;
  useLayoutEffect(() => {
    const r = resume.current;
    if (!r || !ready) return;
    resume.current = null;
    goTo(r.id, { fraction: r.fraction });
  }, [ready, goTo, resume]);
  const tick = useReadFind((s) => s.tick);
  // Only a new jump scrolls: the matches changing under the current one must not.
  const latest = useRef(hits);
  latest.current = hits;
  useLayoutEffect(() => {
    if (!tick || !ready) return;
    const at = locate(latest.current, useReadFind.getState().index);
    if (at) goTo(at.id, { match: true });
  }, [tick, ready, goTo]);
}
