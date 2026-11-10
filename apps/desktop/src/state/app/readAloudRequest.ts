import { create } from "zustand";

interface ReadAloudRequest {
  /** Goes up by one each time the author asks to read aloud from the cursor (View menu). */
  count: number;
  request: () => void;
}

/** View > Read Aloud from Cursor: the editor starts reading when the count changes. */
export const useReadAloudRequest = create<ReadAloudRequest>((set) => ({
  count: 0,
  request: () => set((s) => ({ count: s.count + 1 })),
}));
