/**
 * Helpers for performance tests (same idea as packages/import-docx/src/__tests__/helpers.ts).
 *
 * Wall-clock time also counts the time the process spent waiting for a core while other workers ran, so a linear algorithm
 * failed its budget whenever the suite ran in parallel; CPU time does not. v8 coverage instrumentation makes the same code
 * several times slower, so budgets are scaled up when coverage is collecting. Both still fail for a quadratic or runaway step,
 * which grows by orders of magnitude, and that is what these tests exist to catch.
 */

/** A budget in milliseconds, scaled up while coverage is collecting (5x) and on shared CI runners (4x). */
export function budget(ms: number): number {
  const worker = (
    globalThis as { __vitest_worker__?: { config?: { coverage?: { enabled?: boolean } } } }
  ).__vitest_worker__;
  return ms * (worker?.config?.coverage?.enabled ? 5 : 1) * (process.env.CI ? 4 : 1);
}

/** Starts a clock and returns a function that gives the milliseconds of CPU time this process has used since. */
export function cpuClock(): () => number {
  const t0 = process.cpuUsage();
  return () => {
    const d = process.cpuUsage(t0);
    return (d.user + d.system) / 1000;
  };
}
