/** Words written since the session started. Deleting below the starting count shows 0, never a negative number. */
export const sessionWords = (baseline: number, current: number): number =>
  Math.max(0, current - baseline);

/** Share of the goal reached, 0..1; 0 when no goal is set. */
export const goalProgress = (written: number, goal: number): number =>
  goal > 0 ? Math.min(1, written / goal) : 0;
