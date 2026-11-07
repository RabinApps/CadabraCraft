/**
 * Scrolling on past the end of a section in Write mode, and back above its start. The page stack is one entry's pages, so at its last
 * page a continued scroll means "the next section" (the next front matter page, chapter or back matter page) and at its first page a
 * continued scroll up means the one before. A scroller that fits its content is at both ends at once, so a section of one page also
 * hands over.
 *
 * The module keeps two things: the wheel travel past an edge (so a whole wheel gesture gives way, a trackpad tick does not) and where
 * the next section's scroller should land (its start when coming from above, its end when coming from below, so the two sections read
 * as one document).
 */

/** Wheel travel past an edge that hands over to the neighbouring section, in CSS px. */
export const EDGE_TRAVEL = 100;

/** How far a scroller may sit from an end and still count as being at it (layout rounding, a fractional scroll position). */
const ROUNDING = 2;

export type EdgeIntent = "next" | "prev" | null;

export interface EdgeInput {
  /** Wheel travel past an edge so far (from the previous call). */
  travel: number;
  /** The wheel event's `deltaY`, in its own unit. */
  deltaY: number;
  /** The wheel event's `deltaMode` (0 px, 1 lines, 2 pages). */
  deltaMode: number;
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
}

export interface EdgeStep {
  /** Wheel travel past the edge to carry to the next event. */
  travel: number;
  /** The section to open, or null while the gesture is still inside this one. */
  intent: EdgeIntent;
}

/** `deltaY` in CSS px whatever unit the event used (lines are 16px, pages the height of what is visible). */
export const wheelPx = (deltaY: number, deltaMode: number, clientHeight: number): number =>
  deltaMode === 1 ? deltaY * 16 : deltaMode === 2 ? deltaY * clientHeight : deltaY;

/**
 * What a wheel event means. Past the last page a downward wheel accumulates until `EDGE_TRAVEL` and then asks for the next section;
 * above the first page an upward wheel does the same for the previous one. Scrolling anywhere else, or turning round, starts the
 * count again.
 */
export function edgeStep(input: EdgeInput): EdgeStep {
  const atEnd = input.scrollTop >= input.scrollHeight - input.clientHeight - ROUNDING;
  const atStart = input.scrollTop <= ROUNDING;
  const px = wheelPx(input.deltaY, input.deltaMode, input.clientHeight);
  const down = px > 0 && atEnd;
  const up = px < 0 && atStart;
  if (!down && !up) return { travel: 0, intent: null };
  // Turning round (or leaving the edge) starts the count again: only one direction at a time.
  const carried = Math.sign(input.travel) === Math.sign(px) ? input.travel : 0;
  const travel = carried + px;
  if (Math.abs(travel) < EDGE_TRAVEL) return { travel, intent: null };
  return { travel: 0, intent: down ? "next" : "prev" };
}

/** The sections either side of `currentId` in reading order: what a continued scroll opens. */
export function sectionNeighbours(
  ids: readonly string[],
  currentId: string | null,
): { prev: string | null; next: string | null } {
  const at = currentId === null ? -1 : ids.indexOf(currentId);
  if (at < 0) return { prev: null, next: null };
  return { prev: at > 0 ? ids[at - 1]! : null, next: at < ids.length - 1 ? ids[at + 1]! : null };
}

export type Landing = "start" | "end";

let landing: Landing = "start";

/** Where the section opened next should put its scroller. Read once by the frame that mounts. */
export const requestLanding = (where: Landing): void => {
  landing = where;
};

/** Takes the pending landing, leaving "start" (what a section opened by a click gets). */
export function takeLanding(): Landing {
  const where = landing;
  landing = "start";
  return where;
}
