import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPreviewJob, type JobState } from "../export/previewJob";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

/** A job whose runs are answered by hand, in any order. */
function setup(keyOf?: (r: string) => string | undefined) {
  const runs: { key: string | undefined; ok: (v: string) => void; fail: (e: unknown) => void }[] =
    [];
  const seen: JobState<string>[] = [];
  const job = createPreviewJob<string>({
    run: (key) =>
      new Promise((ok, fail) => {
        runs.push({ key, ok, fail });
      }),
    ...(keyOf ? { keyOf } : {}),
    onChange: (s) => seen.push(s),
  });
  return { job, runs, seen };
}

describe("createPreviewJob", () => {
  it("waits for the delay, then runs once and reports the result", async () => {
    const { job, runs } = setup();
    job.schedule(500, "a");
    expect(job.state().status).toBe("loading");
    vi.advanceTimersByTime(499);
    expect(runs).toHaveLength(0);
    vi.advanceTimersByTime(1);
    expect(runs).toHaveLength(1);
    runs[0]!.ok("one");
    await vi.advanceTimersByTimeAsync(0);
    expect(job.state()).toEqual({ status: "ready", result: "one", key: "a", error: null });
  });

  it("debounces: a newer request replaces one that is still waiting", () => {
    const { job, runs } = setup();
    job.schedule(500, "a");
    vi.advanceTimersByTime(300);
    job.schedule(500, "b");
    vi.advanceTimersByTime(300);
    expect(runs).toHaveLength(0);
    vi.advanceTimersByTime(200);
    expect(runs.map((r) => r.key)).toEqual(["b"]);
  });

  it("drops a result that arrives after a newer request started", async () => {
    const { job, runs } = setup();
    job.schedule(0, "old");
    vi.advanceTimersByTime(0);
    job.schedule(0, "new");
    vi.advanceTimersByTime(0);
    expect(runs).toHaveLength(2);
    // The newer one answers first; the older one arrives late and must not overwrite it.
    runs[1]!.ok("new result");
    await vi.advanceTimersByTimeAsync(0);
    runs[0]!.ok("old result");
    await vi.advanceTimersByTimeAsync(0);
    expect(job.state()).toMatchObject({ status: "ready", result: "new result", key: "new" });
  });

  it("drops a failure that arrives after a newer request started", async () => {
    const { job, runs } = setup();
    job.schedule(0, "old");
    vi.advanceTimersByTime(0);
    job.schedule(0, "new");
    runs[0]!.fail(new Error("late"));
    await vi.advanceTimersByTimeAsync(0);
    expect(job.state().status).toBe("loading");
    expect(job.state().error).toBeNull();
  });

  it("makes nothing for the key of the result on screen, and drops a run in flight for another", async () => {
    const { job, runs } = setup();
    job.schedule(0, "a");
    vi.advanceTimersByTime(0);
    runs[0]!.ok("A");
    await vi.advanceTimersByTimeAsync(0);
    job.schedule(0, "b");
    vi.advanceTimersByTime(0);
    expect(runs).toHaveLength(2);
    // Back to the text that is still on screen before "b" answers: nothing to make, and "b" is stale.
    job.schedule(0, "a");
    expect(job.state()).toMatchObject({ status: "ready", result: "A", key: "a" });
    runs[1]!.ok("B");
    await vi.advanceTimersByTimeAsync(0);
    vi.advanceTimersByTime(10_000);
    expect(runs).toHaveLength(2);
    expect(job.state().result).toBe("A");
  });

  it("keeps the last result when a run fails and offers a retry with the same key", async () => {
    const { job, runs } = setup();
    job.schedule(0, "a");
    vi.advanceTimersByTime(0);
    runs[0]!.ok("A");
    await vi.advanceTimersByTimeAsync(0);
    job.schedule(0, "b");
    vi.advanceTimersByTime(0);
    runs[1]!.fail(new Error("boom"));
    await vi.advanceTimersByTimeAsync(0);
    expect(job.state()).toMatchObject({ status: "error", result: "A", error: "boom" });
    // The same key again still runs: an error is never "current".
    job.schedule(0, "b");
    vi.advanceTimersByTime(0);
    expect(runs).toHaveLength(3);
    runs[2]!.ok("B");
    await vi.advanceTimersByTimeAsync(0);
    expect(job.state()).toMatchObject({ status: "ready", result: "B", error: null });
  });

  it("reports a thrown value that is not an Error as text", async () => {
    const { job, runs } = setup();
    job.schedule(0);
    vi.advanceTimersByTime(0);
    runs[0]!.fail("plain");
    await vi.advanceTimersByTimeAsync(0);
    expect(job.state()).toMatchObject({ status: "error", error: "plain", result: null });
  });

  it("cancel drops what is waiting or in flight and keeps the result", async () => {
    const { job, runs } = setup();
    job.schedule(0, "a");
    vi.advanceTimersByTime(0);
    runs[0]!.ok("A");
    await vi.advanceTimersByTimeAsync(0);
    job.schedule(500, "b");
    job.cancel();
    expect(job.state()).toMatchObject({ status: "ready", result: "A" });
    vi.advanceTimersByTime(1000);
    expect(runs).toHaveLength(1);
    // In flight: its answer is dropped.
    job.schedule(0, "c");
    vi.advanceTimersByTime(0);
    job.cancel();
    runs[1]!.ok("C");
    await vi.advanceTimersByTimeAsync(0);
    expect(job.state()).toMatchObject({ status: "ready", result: "A" });
  });

  it("cancel before any result goes back to idle; cancelling an idle job does nothing", () => {
    const { job, seen } = setup();
    job.cancel();
    expect(seen).toHaveLength(0);
    job.schedule(0, "a");
    job.cancel();
    expect(job.state().status).toBe("idle");
  });

  it("stores the key a result says it is for (a run that fell back to another kind of result)", async () => {
    const { job, runs } = setup((r) => (r.startsWith("approx") ? r : undefined));
    job.schedule(0, "book:1");
    vi.advanceTimersByTime(0);
    runs[0]!.ok("approx:k");
    await vi.advanceTimersByTimeAsync(0);
    expect(job.state().key).toBe("approx:k");
    job.schedule(0, "approx:k");
    expect(runs).toHaveLength(1);
  });

  it("runs again without a key, and a request without a key never counts as current", async () => {
    const { job, runs } = setup();
    job.schedule(0);
    vi.advanceTimersByTime(0);
    runs[0]!.ok("A");
    await vi.advanceTimersByTimeAsync(0);
    job.schedule(0);
    vi.advanceTimersByTime(0);
    expect(runs).toHaveLength(2);
    expect(job.state().key).toBeNull();
  });
});
