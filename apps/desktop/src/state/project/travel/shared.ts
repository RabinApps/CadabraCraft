import { t } from "@lingui/core/macro";
import { readingOrder, sourceFile } from "@cadabracraft/format";
import type { History, HistoryEntry } from "../types";
import type { Ctx } from "../context";

export type Direction = "undo" | "redo";

/** The history after `from`'s newest entry moved to the other stack as `flipped` (`fix` rewrites the other entries, e.g. after a rename). */
export const flipHistory = (
  history: History,
  from: Direction,
  flipped: HistoryEntry,
  fix: (e: HistoryEntry) => HistoryEntry = (e) => e,
): History => {
  const kept = history[from].slice(0, -1).map(fix);
  const other = (from === "undo" ? history.redo : history.undo).map(fix);
  return from === "undo"
    ? { undo: kept, redo: [...other, flipped] }
    : { undo: [...other, flipped], redo: kept };
};

export const doneNotice = (from: Direction, label: string): string =>
  from === "undo" ? t`Undid: ${label}` : t`Redid: ${label}`;

export const createShowAfterTravel = (ctx: Ctx) => {
  const { set, get, need, entryOf, load } = ctx;
  /** Shows a page that came back; otherwise keeps the open page unless it no longer exists. */
  return async (file: string | undefined, present: boolean) => {
    const next = need().manifest;
    const shown =
      file && present
        ? readingOrder(next).find((e) => sourceFile(e, next.editions) === file)
        : undefined;
    const cur = get().currentId;
    if (shown) {
      await load(shown.id);
      return;
    }
    if (!cur || entryOf(next, cur)) return;
    set({ currentId: null, currentDoc: null });
    const fallback = next.chapters[0] ?? readingOrder(next)[0];
    if (fallback) await load(fallback.id);
  };
};
