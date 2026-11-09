/**
 * The read-aloud state machine: which sentence is being read and whether reading is running, paused or stopped. Pure,
 * so the rules (advance, pause, stop, read from the cursor) are tested without audio or the editor.
 */
export type ReadStatus = "idle" | "reading" | "paused";

export interface ReadState {
  status: ReadStatus;
  /** The sentence being read (index into the chapter's sentence list); -1 when stopped. */
  index: number;
}

export const STOPPED: ReadState = { status: "idle", index: -1 };

/** Reading starts at sentence `index` of `count`. Nothing to read (no sentences, or an index past the end) stays stopped. */
export function start(count: number, index: number): ReadState {
  return index >= 0 && index < count ? { status: "reading", index } : STOPPED;
}

/** The next sentence after the one just read; the last one ends reading. */
export function advance(state: ReadState, count: number): ReadState {
  if (state.status === "idle") return state;
  return state.index + 1 < count ? { status: "reading", index: state.index + 1 } : STOPPED;
}

export function pause(state: ReadState): ReadState {
  return state.status === "reading" ? { ...state, status: "paused" } : state;
}

export function resume(state: ReadState): ReadState {
  return state.status === "paused" ? { ...state, status: "reading" } : state;
}

/** The first sentence whose end is after the cursor: the one the cursor is in, or the next one. -1 when the cursor is past them all. */
export function indexAtCursor(sentences: readonly { to: number }[], cursor: number): number {
  return sentences.findIndex((s) => s.to > cursor);
}
