import { useEffect, useRef } from "react";
import { useLingui } from "@lingui/react/macro";
import { useDragReorder } from "../../ui/useDragReorder";
import { dropPosition, insertionIndex } from "../../lib/references/referenceKinds";
import { useProject } from "../../state/project/index";
import { attempt } from "../../state/attempt";
import type { Landing } from "./BoardColumn";
import type { BoardChapter } from "./useBoardData";

/** Moving scenes on the board: dragging, the grip's keys and the card menu all end in `place`, which says where the scene went. */
export function useSceneMoves(chapters: BoardChapter[], say: (message: string) => void) {
  const { t } = useLingui();
  const actions = useProject((s) => s.actions);
  // A card that moved is drawn again once its chapter files have been read, and moving a focused element in the page drops its focus:
  // for a moment after a move, each new reading puts the focus back on the grip of the card that moved.
  const refocus = useRef({ id: "", until: 0 });
  useEffect(() => {
    if (Date.now() > refocus.current.until) return;
    const grip = document.querySelector<HTMLElement>(
      `[data-grip-for="${CSS.escape(refocus.current.id)}"]`,
    );
    if (grip && document.activeElement !== grip) grip.focus();
  }, [chapters]);

  const columns = useRef(new Map<string, HTMLElement>());
  const { drag, grab } = useDragReorder<Landing>({
    locate: (x, y) => {
      let best: { id: string; el: HTMLElement; gap: number } | null = null;
      for (const [id, el] of columns.current) {
        const r = el.getBoundingClientRect();
        if (r.width === 0) continue; // a chapter the phone is not showing
        const gap = Math.max(r.left - x, x - r.right, 0);
        if (!best || gap < best.gap) best = { id, el, gap };
      }
      if (!best) return { chapter: "", index: 0 };
      const middles = [...best.el.querySelectorAll("[data-scene-card]")].map((card) => {
        const r = card.getBoundingClientRect();
        return r.top + r.height / 2;
      });
      return { chapter: best.id, index: insertionIndex(middles, y) };
    },
    onDrop: (id, at) => {
      if (!at.chapter) return;
      const from = chapters.find((c) => c.rows.some((r) => r.id === id));
      if (!from) return;
      const fromIndex = from.rows.findIndex((r) => r.id === id);
      const to = from.id === at.chapter ? dropPosition(fromIndex, at.index) : at.index;
      if (from.id === at.chapter && to === fromIndex) return;
      place(id, at.chapter, to);
    },
  });

  /** Moves a scene and says where it went (the grip keeps its name, so nothing else would say it moved). */
  const place = (sceneId: string, chapterId: string, index: number) => {
    const chapter = chapters.find((c) => c.id === chapterId);
    const scene = chapters.flatMap((c) => c.rows).find((r) => r.id === sceneId);
    if (!chapter || !scene) return;
    const title = scene.title || t`Untitled scene`;
    const chapterTitle = chapter.title;
    const same = chapter.rows.some((r) => r.id === sceneId);
    const count = chapter.rows.length + (same ? 0 : 1);
    const place = Math.min(index, count - 1) + 1;
    refocus.current = { id: sceneId, until: Date.now() + 2000 };
    attempt(
      actions.moveScene(sceneId, chapterId, index).then((moved) => {
        if (moved) say(t`Moved ${title} to position ${place} of ${count} in ${chapterTitle}`);
      }),
    );
  };

  const movesOf = (c: BoardChapter, i: number, at: number) => ({
    index: i,
    count: c.rows.length,
    chapters: chapters.filter((o) => o.id !== c.id).map((o) => ({ id: o.id, title: o.title })),
    step: (delta: -1 | 1) => {
      const scene = c.rows[i]!;
      const title = scene.title || t`Untitled scene`;
      if (i + delta < 0) return say(t`${title} is already first in ${c.title}`);
      if (i + delta >= c.rows.length) return say(t`${title} is already last in ${c.title}`);
      place(scene.id, c.id, i + delta);
    },
    beside: (delta: -1 | 1) => {
      const next = chapters[at + delta];
      const title = c.rows[i]!.title || t`Untitled scene`;
      if (!next)
        return say(
          delta < 0
            ? t`${title} is already in the first chapter`
            : t`${title} is already in the last chapter`,
        );
      place(c.rows[i]!.id, next.id, Math.min(i, next.rows.length));
    },
    toChapter: (chapterId: string) => {
      const next = chapters.find((o) => o.id === chapterId);
      if (next) place(c.rows[i]!.id, next.id, next.rows.length);
    },
  });

  return { columns, drag, grab, movesOf };
}
