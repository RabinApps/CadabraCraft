import { plural, t } from "@lingui/core/macro";
import type { BookSnapshotEntry, BookSnapshotLimits, BookSnapshotPrune } from "../../../lib/bridge";

const MB = 1024 * 1024;
const GB = 1024 * MB;

/** A byte count as "12 KB", "340 MB" or "1.2 GB" (the unit symbols are the same in every language). */
export function formatSize(bytes: number, locale: string): string {
  const num = (n: number, digits: number) => {
    try {
      return new Intl.NumberFormat(locale, { maximumFractionDigits: digits }).format(n);
    } catch {
      return new Intl.NumberFormat(undefined, { maximumFractionDigits: digits }).format(n); // the pseudo locale is not a real one
    }
  };
  if (bytes >= GB) return `${num(bytes / GB, 1)} GB`;
  if (bytes >= MB) return `${num(Math.round(bytes / MB), 0)} MB`;
  return `${num(Math.max(1, Math.round(bytes / 1024)), 0)} KB`;
}

/** The header over the list: "12 snapshots · 340 MB". */
export function summaryLine(list: BookSnapshotEntry[], locale: string): string {
  const total = list.reduce((sum, e) => sum + e.bytes, 0);
  return `${plural(list.length, { one: "# snapshot", other: "# snapshots" })} · ${formatSize(total, locale)}`;
}

/** The limits the author set, as Rust takes them. */
export const limitsOf = (s: {
  bookSnapshotKeep: number;
  bookSnapshotMaxMb: number;
}): BookSnapshotLimits => ({
  maxCount: s.bookSnapshotKeep,
  maxMb: s.bookSnapshotMaxMb,
});

/** What to tell the author when keeping to the limits moved snapshots to the trash. */
export interface PruneNotice {
  /** Older snapshots moved for the count or size limit (an ordinary notice). */
  older: string | null;
  /** Pinned snapshots moved too (a warning: only when the pinned ones alone pass the size ceiling). */
  pinned: string | null;
}

/** The notice for a prune result; null when nothing moved. */
export function pruneNotice(pruned: BookSnapshotPrune): PruneNotice | null {
  if (pruned.moved <= 0) return null;
  const pinned = pruned.pinned_moved.length;
  const older = pruned.moved - pinned;
  return {
    older:
      older > 0
        ? plural(older, {
            one: "# older snapshot moved to .cadabra/trash",
            other: "# older snapshots moved to .cadabra/trash",
          })
        : null,
    pinned:
      pinned > 0
        ? plural(pinned, {
            one: "# pinned snapshot moved to .cadabra/trash too, because the pinned snapshots alone take more than the size limit allows. Unpin or delete some, or raise the size limit in Settings.",
            other:
              "# pinned snapshots moved to .cadabra/trash too, because the pinned snapshots alone take more than the size limit allows. Unpin or delete some, or raise the size limit in Settings.",
          })
        : null,
  };
}

/** Why a new name was refused before it was sent, or null when it is fine. */
export const nameProblem = (name: string): string | null =>
  name.trim() ? null : t`The snapshot has no name. Type one, for example “Before the rewrite”.`;
