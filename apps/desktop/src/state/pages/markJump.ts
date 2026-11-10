import { create } from "zustand";

/** A marked place to open the editor at: a chapter and the id of its `indexEntry` mark, or of a `glossaryTerm` mark (first use). */
export interface MarkJump {
  chapterId: string;
  kind: "index" | "glossary";
  /** The mark's `id` attribute. */
  id: string;
}

/**
 * Where the Index and Glossary panels send the author: the panel sets it and opens the chapter; the editor of that chapter takes it
 * when it is ready (`takeMarkJump`) and selects the marked words.
 */
export const useMarkJump = create<{ pending: MarkJump | null; count: number }>(() => ({
  pending: null,
  count: 0,
}));

export const requestMarkJump = (jump: MarkJump): void =>
  useMarkJump.setState((s) => ({ pending: jump, count: s.count + 1 }));

/** The pending jump if it is for chapter `id`, which is then cleared; a jump for another chapter stays until its editor opens. */
export function takeMarkJump(id: string | null): MarkJump | null {
  const { pending } = useMarkJump.getState();
  if (!pending || pending.chapterId !== id) return null;
  useMarkJump.setState({ pending: null });
  return pending;
}
