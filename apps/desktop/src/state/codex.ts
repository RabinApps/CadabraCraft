import { t } from "@lingui/core/macro";
import { isCodexFile, type CodexEntry } from "@cadabracraft/format";
import { create } from "zustand";
import { bridge } from "../lib/bridge";
import { useProject } from "./project/index";

/** Where the codex lives: beside the book, in its folder, so it syncs with the rest of the project. */
export const codexFile = "codex.json";

interface CodexState {
  entries: CodexEntry[];
  /** The project the entries were read from (so opening another book reads its own). */
  loadedFor: string | null;
  /** Why the file could not be read or written, as a sentence for the author; empty when all is well. */
  error: string;
  load: (root: string) => Promise<void>;
  /** Writes the whole file and shows the change at once; puts the old list back when the write fails. */
  save: (next: CodexEntry[]) => Promise<boolean>;
}

export const useCodex = create<CodexState>((set, get) => ({
  entries: [],
  loadedFor: null,
  error: "",
  async load(root) {
    if (get().loadedFor === root) return;
    let read: Awaited<ReturnType<typeof bridge.readFile>>;
    try {
      read = await bridge.readFile(root, codexFile);
    } catch {
      set({
        entries: [],
        loadedFor: root,
        error: t`The codex could not be read, so it was not opened. The file was left as it is.`,
      });
      return;
    }
    if (!read) {
      set({ entries: [], loadedFor: root, error: "" });
      return;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(read.contents);
    } catch {
      set({
        entries: [],
        loadedFor: root,
        error: t`The codex is not valid JSON, so it was not opened. The file was left untouched.`,
      });
      return;
    }
    if (!isCodexFile(parsed)) {
      set({
        entries: [],
        loadedFor: root,
        error: t`The codex could not be opened: it is not the shape a codex has. The file was left untouched.`,
      });
      return;
    }
    set({ entries: parsed.entries, loadedFor: root, error: "" });
  },
  async save(next) {
    const root = useProject.getState().root ?? get().loadedFor;
    if (!root) return false;
    const before = get().entries;
    set({ entries: next, error: "" });
    try {
      await bridge.writeFile(
        root,
        codexFile,
        `${JSON.stringify({ entries: next }, null, 2)}\n`,
        null,
      );
      return true;
    } catch {
      set({ entries: before, error: t`The codex could not be saved. Try again.` });
      return false;
    }
  },
}));
