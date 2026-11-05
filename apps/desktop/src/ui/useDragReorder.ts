import { useEffect, useRef, useState, type PointerEvent } from "react";

/** A drag in progress: the dragged thing's id and where it would land if let go now. */
export interface DragState<T> {
  id: string;
  at: T;
}

interface Options<T> {
  /** Where a drop at this pointer position would land. A list answers with an index; the scene board with a chapter and an index. */
  locate: (x: number, y: number) => T;
  /** Called once when the pointer is let go. Not called when the drag was cancelled. */
  onDrop: (id: string, at: T) => void;
}

/**
 * The pointer drag behind reordering lists: a grip starts it, moving the pointer updates where it would land, letting go drops,
 * and Escape or a cancelled pointer ends it with nothing changed. It draws nothing (callers show a drop line from `drag.at`)
 * and knows nothing about the target's shape, so the chapter list (one dimension) and the scene board (columns of cards) share it.
 * Every drag also needs a keyboard route; that stays with the caller (the grip's arrow keys, a move menu).
 */
export function useDragReorder<T>({ locate, onDrop }: Options<T>) {
  const [drag, setDrag] = useState<DragState<T> | null>(null);
  const at = useRef<T | undefined>(undefined);
  // The newest callbacks, so the window listeners below are not torn down on every render of the list.
  const latest = useRef({ locate, onDrop });
  latest.current = { locate, onDrop };
  const dragId = drag?.id;
  useEffect(() => {
    if (!dragId) return;
    const move = (e: globalThis.PointerEvent) => {
      at.current = latest.current.locate(e.clientX, e.clientY);
      setDrag({ id: dragId, at: at.current });
    };
    const cancel = () => setDrag(null);
    const escape = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape") cancel();
    };
    const drop = () => {
      setDrag(null);
      latest.current.onDrop(dragId, at.current as T);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", drop);
    window.addEventListener("pointercancel", cancel);
    window.addEventListener("keydown", escape);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", drop);
      window.removeEventListener("pointercancel", cancel);
      window.removeEventListener("keydown", escape);
    };
  }, [dragId]);
  /** The grip's `onPointerDown`: starts dragging `id`, which would land at `start` until the pointer moves. */
  const grab = (id: string, start: T) => (e: PointerEvent<HTMLElement>) => {
    e.preventDefault();
    at.current = start;
    setDrag({ id, at: start });
  };
  return { drag, grab, cancel: () => setDrag(null) };
}
