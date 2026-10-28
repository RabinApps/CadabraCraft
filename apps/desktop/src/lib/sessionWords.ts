/** Words written since the session started. Deleting below the starting count shows 0, never a negative number. */
export const sessionWords = (baseline: number, current: number): number =>
  Math.max(0, current - baseline);
