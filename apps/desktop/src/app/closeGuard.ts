/** What the close handler needs from the app, so it can be tested without a window. */
export interface CloseGuard {
  /** True while typing sits unsaved in the editor. */
  hasUnsaved: () => boolean;
  /** Writes the unsaved typing; rejects when it cannot. */
  flush: () => Promise<void>;
  /** Tells the author the save failed (the window stays open). `message` is the error text. */
  onSaveFailed: (message: string) => void;
}

interface CloseEvent {
  preventDefault: () => void;
}

/**
 * Handler for the window's close request. With nothing unsaved the window just closes. Otherwise the close is held
 * back until the last typing is on disk, then the window is destroyed. If the save fails the window stays open and the
 * author is told; asking to close again then closes it anyway, so a permanent write error never traps the window.
 */
export function createCloseHandler(guard: CloseGuard, destroy: () => Promise<void>): (e: CloseEvent) => Promise<void> {
  let failed = false;
  return async (e) => {
    if (!guard.hasUnsaved()) {
      failed = false;
      return;
    }
    if (failed) return; // the author already saw the failure and asked again: let the window close
    e.preventDefault();
    try {
      await guard.flush();
    } catch (err) {
      failed = true;
      guard.onSaveFailed(err instanceof Error ? err.message : String(err));
      return;
    }
    await destroy();
  };
}
