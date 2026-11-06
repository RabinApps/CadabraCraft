import type { BoardData } from "./boardData";
import type { SceneRow } from "./scenes";

/** `book`: scenes as the book reads. `story`: by story date where a scene has one. */
export type TimelineOrder = "book" | "story";

/** One scene on the axis with where it sits in the book. */
export interface TimelineItem {
  scene: SceneRow;
  chapterId: string;
  chapterTitle: string;
  /** Position in the book (0-based), whatever the order shown. */
  bookIndex: number;
  /** True when the scene has a story date of its own. */
  dated: boolean;
  /** For an undated scene in story order: the title of the scene before it in the book, which it stays behind (null at the start). */
  follows: string | null;
}

/**
 * The scenes of the book on one axis. In book order the axis is the book. In story order each dated scene goes by its date
 * (a date without a time sorts before the same day with a time) and a scene without a date keeps its place behind the scene before it
 * in the book, so adding dates to a few scenes never throws the others about. Ties keep book order. A scene at the start of the
 * book without a date stays before every dated one.
 */
export function buildTimeline(board: BoardData, order: TimelineOrder): TimelineItem[] {
  const flat = board.chapters.flatMap((c) => c.rows.map((scene) => ({ scene, c })));
  let key = "";
  let before: string | null = null;
  const items = flat.map(({ scene, c }, bookIndex) => {
    const dated = scene.date !== "";
    if (dated) key = scene.date;
    const item = {
      item: {
        scene,
        chapterId: c.id,
        chapterTitle: c.title,
        bookIndex,
        dated,
        follows: !dated && order === "story" ? before : null,
      } satisfies TimelineItem,
      key,
    };
    before = scene.title;
    return item;
  });
  if (order === "story") {
    items.sort((a, b) =>
      a.key < b.key ? -1 : a.key > b.key ? 1 : a.item.bookIndex - b.item.bookIndex,
    );
  }
  return items.map((i) => i.item);
}

const parts = (date: string) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?$/.exec(date);
  return m
    ? { y: +m[1]!, mo: +m[2]!, d: +m[3]!, h: m[4] ? +m[4] : null, mi: m[5] ? +m[5] : null }
    : null;
};

/** The day part of a story date (`YYYY-MM-DD`), or empty. */
export const storyDay = (date: string): string => (parts(date) ? date.slice(0, 10) : "");

/** The time part of a story date (`HH:MM`), or empty. */
export const storyTime = (date: string): string => (date.length > 10 ? date.slice(11, 16) : "");

/** A day and a time from the two fields back into one story date; no day means no date, and a time needs a day. */
export const joinStoryDate = (day: string, time: string): string =>
  day === "" ? "" : time === "" ? day : `${day}T${time}`;

/** The day of a story date written out for the reader's language ("Sep 3, 1893"), or the date as it is when it is not a real one. */
export function formatStoryDay(date: string, locale?: string): string {
  const p = parts(date);
  if (!p) return date;
  // The calendar day is the date's own: UTC keeps the reader's time zone from moving it.
  const at = new Date(Date.UTC(2000, p.mo - 1, p.d));
  at.setUTCFullYear(p.y);
  return new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeZone: "UTC" }).format(at);
}

/** The time of a story date in the reader's language ("6:40 PM"), or empty when it has none. */
export function formatStoryTime(date: string, locale?: string): string {
  const p = parts(date);
  if (!p || p.h === null || p.mi === null) return "";
  const at = new Date(Date.UTC(2000, 0, 1, p.h, p.mi));
  return new Intl.DateTimeFormat(locale, { timeStyle: "short", timeZone: "UTC" }).format(at);
}
