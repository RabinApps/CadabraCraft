/**
 * How the outline navigator reaches the open editor: the editor registers a function that moves the caret to its Nth heading
 * (the number `extractOutline` gives) while it is mounted; the navigator calls it. Nothing is registered in Read mode.
 */
type Jump = (index: number) => boolean;

let current: Jump | null = null;

/** Registers the jump function; returns the function that removes it (only if it is still the registered one). */
export function registerHeadingJump(jump: Jump): () => void {
  current = jump;
  return () => {
    if (current === jump) current = null;
  };
}

/** Moves the editor to its `index`th heading. False when no editor is open or it has no such heading. */
export const jumpToHeading = (index: number): boolean => current?.(index) ?? false;
