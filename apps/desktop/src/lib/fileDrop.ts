import type { DropPoint } from "./bridge/references";

/** Marks the part of the window where a file dropped on the page is for the editor (the page and its toolbar). */
export const EDITOR_DROP_ATTR = "data-editor-drop";

/**
 * True when a native file drag at `at` is over the editor. Files dropped on the window go to exactly one owner: the editor
 * when they are over it, the References panel everywhere else, so both ask this and exactly one acts.
 */
export function overEditor(at: DropPoint | undefined): boolean {
  if (!at) return false;
  // Not every environment can hit-test (the unit tests have no page): nothing is over the editor there.
  const hit = globalThis.document?.elementFromPoint?.(at.x, at.y);
  return !!hit?.closest(`[${EDITOR_DROP_ATTR}]`);
}
