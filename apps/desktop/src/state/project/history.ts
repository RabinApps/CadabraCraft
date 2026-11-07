import { plural, t } from "@lingui/core/macro";
import { whyText } from "../../lib/projectError";
import { alertOf, PartialWrite } from "./util";
import type { HistoryActions } from "./types";
import type { Ctx } from "./context";
import { createTravelEntries } from "./travel/entries";
import type { Direction } from "./travel/shared";

/** The alert for a failed undo or redo, naming the pages that could not be put back. */
const failure = (from: Direction, e: unknown) => {
  const why = whyText(e);
  const stuck = e instanceof PartialWrite ? e.stuck.length : 0;
  const base =
    from === "undo"
      ? t`Could not undo: ${why}. Try again, or restore the page from History.`
      : t`Could not redo: ${why}. Try again, or restore the page from History.`;
  return alertOf(
    stuck
      ? `${base} ${plural(stuck, { one: "# page could not be put back and is now in the other state.", other: "# pages could not be put back and are now in the other state." })}`
      : base,
  );
};

/** Undo and redo of chapter-tree edits (and book-wide replaces). */
export const createHistoryActions = (ctx: Ctx): HistoryActions => {
  const { set, get, flush } = ctx;
  const { travelReference, travelDocs, travelTree, travelImport } = createTravelEntries(ctx);
  let historyBusy = false;
  /** Undoes (`from` = "undo") or redoes (`from` = "redo") the latest entry of that stack. */
  const travel = async (from: Direction): Promise<boolean> => {
    if (historyBusy) return false;
    historyBusy = true;
    try {
      await flush();
      const entry = get().history[from].at(-1);
      if (!entry) return false;
      if (entry.reference) await travelReference({ ...entry, reference: entry.reference }, from);
      else if (entry.docs) await travelDocs({ ...entry, docs: entry.docs }, from);
      else if (entry.imported) await travelImport({ ...entry, imported: entry.imported }, from);
      else await travelTree(entry, from);
      return true;
    } catch (e) {
      set(failure(from, e));
      return false;
    } finally {
      historyBusy = false;
    }
  };
  return {
    undo: () => travel("undo"),
    redo: () => travel("redo"),
  };
};
