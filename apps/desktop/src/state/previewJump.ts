import { create } from "zustand";
import type { PreviewTarget } from "../lib/previewTarget";

/**
 * Where the print preview sends the author: a page of the preview opens the chapter in the editor at the text that starts the page.
 * The preview sets it and leaves; the editor of that chapter takes it when it mounts (`takePreviewJump`) and moves the caret there.
 */
export const usePreviewJump = create<{ pending: PreviewTarget | null }>(() => ({ pending: null }));

export const requestPreviewJump = (target: PreviewTarget): void =>
  usePreviewJump.setState({ pending: target });

/** The pending jump if it is for chapter `id`, which is then cleared; else null (a jump for another chapter stays until its editor opens). */
export function takePreviewJump(id: string | null): PreviewTarget | null {
  const { pending } = usePreviewJump.getState();
  if (!pending || pending.id !== id) return null;
  usePreviewJump.setState({ pending: null });
  return pending;
}

export const clearPreviewJump = (): void => usePreviewJump.setState({ pending: null });
