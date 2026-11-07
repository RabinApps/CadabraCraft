import { useEffect, useRef } from "react";
import { dropPosition, insertionIndex } from "../../../lib/references/referenceKinds";
import { attempt } from "../../../state/attempt";
import { useProject } from "../../../state/project/index";
import { useDragReorder } from "../../../ui/useDragReorder";

/**
 * Drag-to-reorder for the reference list: the row being dragged, the insertion point under the pointer, and the focus
 * hand-off after keyboard moves. The pointer handling is the shared `useDragReorder` (Escape or a cancelled pointer drops nothing).
 */
export function useReferenceReorder(references: { id: string }[]) {
  const actions = useProject((s) => s.actions);
  const list = useRef<HTMLUListElement>(null);
  const { drag, grab } = useDragReorder<number>({
    locate: (_x, y) =>
      insertionIndex(
        [...list.current!.children].map((li) => {
          const r = li.getBoundingClientRect();
          return r.top + r.height / 2;
        }),
        y,
      ),
    onDrop: (id, at) => {
      const from = references.findIndex((r) => r.id === id);
      const to = dropPosition(from, at);
      if (to !== from) attempt(actions.moveReference(id, to));
    },
  });
  /** After a keyboard move the grip keeps focus, even if React moved its row in the DOM. */
  const refocus = useRef<string | null>(null);
  useEffect(() => {
    const id = refocus.current;
    if (!id) return;
    refocus.current = null;
    list.current
      ?.querySelector<HTMLElement>(`[data-ref-id="${CSS.escape(id)}"] [data-grip]`)
      ?.focus();
  }, [references]);
  return { drag, list, grab, refocus };
}
