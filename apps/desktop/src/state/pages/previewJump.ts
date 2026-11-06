import { create } from "zustand";
import type { WordClick } from "../../lib/export/pdfWords";
import type { PreviewTarget } from "../../lib/export/previewTarget";

/** A place to open the editor at, and when the author clicked a word of the page, the words of that page and which was clicked. */
export type PreviewJump = PreviewTarget & { click?: WordClick };

/**
 * Where the print preview sends the author: a page of the preview opens the chapter in the editor at the text that starts the page.
 * The preview sets it and leaves; the editor of that chapter takes it when it mounts (`takePreviewJump`) and moves the caret there.
 */
export const usePreviewJump = create<{ pending: PreviewJump | null }>(() => ({ pending: null }));

export const requestPreviewJump = (target: PreviewTarget, click?: WordClick): void =>
  usePreviewJump.setState({ pending: click ? { ...target, click } : target });

/** The pending jump if it is for chapter `id`, which is then cleared; else null (a jump for another chapter stays until its editor opens). */
export function takePreviewJump(id: string | null): PreviewJump | null {
  const { pending } = usePreviewJump.getState();
  if (!pending || pending.id !== id) return null;
  usePreviewJump.setState({ pending: null });
  return pending;
}

export const clearPreviewJump = (): void => usePreviewJump.setState({ pending: null });
