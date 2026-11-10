import { create } from "zustand";

/** Whether the Index and Glossary panels are open as sheets (below the xl breakpoint, where there is no side panel). */
export const useIndexSheets = create<{
  index: boolean;
  glossary: boolean;
  set: (patch: { index?: boolean; glossary?: boolean }) => void;
}>((set) => ({ index: false, glossary: false, set: (patch) => set(patch) }));
