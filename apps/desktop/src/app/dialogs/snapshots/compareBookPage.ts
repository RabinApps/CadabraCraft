import { bridge, type BookSnapshotEntry } from "../../../lib/bridge";
import { isProjectError } from "../../../lib/projectError";
import { compareWithCurrent, readCurrentParagraphs, type Compared } from "./chapterCompare";

/** This chapter in a book snapshot against the current text. */
export type BookCompare =
  | { status: "idle" }
  | { status: "loading" }
  /** `gone`: the chapter has no file in the book now, so everything in the snapshot counts as "in this version only". */
  | { status: "ready"; compared: Compared; gone: boolean }
  /** The snapshot has no copy of this chapter. */
  | { status: "missing" }
  /** The snapshot has the page but its text is not a valid chapter. */
  | { status: "unreadable" }
  | { status: "error"; error: unknown };

/** Reads `file` from the snapshot and compares it with the saved current text; never throws. */
export async function loadBookCompare(
  root: string,
  snapshot: BookSnapshotEntry,
  file: string,
): Promise<BookCompare> {
  if (!snapshot.pages.includes(file)) return { status: "missing" };
  try {
    const current = await readCurrentParagraphs(root, file);
    const read = await bridge.readBookSnapshotPage(root, snapshot.path, file);
    const compared = compareWithCurrent(current ?? [], read.contents);
    if (compared.words === null) return { status: "unreadable" };
    return { status: "ready", compared, gone: current === null };
  } catch (error) {
    if (isProjectError(error) && error.kind === "not_found") {
      return { status: "missing" }; // the file was in the list but is gone from the snapshot
    }
    return { status: "error", error };
  }
}
