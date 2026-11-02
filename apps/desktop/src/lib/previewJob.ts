/**
 * A debounced, restartable job for a preview that is drawn from something slow (Typst) or cheap (an HTML estimate): the newest
 * request wins, a result that arrives after a newer request started is dropped, and the last good result stays on screen
 * while the next one is made. Pure (timers and promises only), so the React hook around it stays thin.
 */
export type JobStatus = "idle" | "loading" | "ready" | "error";

export interface JobState<R> {
  status: JobStatus;
  /** The latest good result; kept while a newer one is made or when that one fails. */
  result: R | null;
  /** The key the result was made for (see `schedule`). */
  key: string | null;
  /** Why the latest run failed. */
  error: string | null;
}

export interface PreviewJob<R> {
  /**
   * Starts a run after `delayMs`, replacing any run that is waiting or in flight. With a `key` that equals the one of the result on
   * screen nothing is made (the result is current); a run that is in flight for another key is dropped.
   */
  schedule: (delayMs: number, key?: string) => void;
  /** Drops what is waiting or in flight (the preview was hidden); the result stays. */
  cancel: () => void;
  state: () => JobState<R>;
}

const message = (e: unknown): string => (e instanceof Error ? e.message : String(e));

export function createPreviewJob<R>(options: {
  /** Makes the result; `key` is the one passed to `schedule`. */
  run: (key: string | undefined) => Promise<R>;
  /** The key a result is for when it is not the one asked for (a run that fell back to another kind of result). */
  keyOf?: (result: R) => string | undefined;
  onChange: (state: JobState<R>) => void;
}): PreviewJob<R> {
  let state: JobState<R> = { status: "idle", result: null, key: null, error: null };
  let timer: ReturnType<typeof setTimeout> | undefined;
  /** Counts the requests; a run whose number is no longer the latest is stale. */
  let latest = 0;
  const update = (next: JobState<R>) => {
    state = next;
    options.onChange(next);
  };
  const stop = () => {
    clearTimeout(timer);
    timer = undefined;
    latest += 1;
  };
  return {
    state: () => state,
    schedule(delayMs, key) {
      stop();
      if (key !== undefined && state.status !== "error" && state.key === key && state.result) {
        if (state.status !== "ready") update({ ...state, status: "ready" });
        return;
      }
      const mine = latest;
      update({ ...state, status: "loading", error: null });
      timer = setTimeout(() => {
        timer = undefined;
        options.run(key).then(
          (result) => {
            if (mine === latest)
              update({
                status: "ready",
                result,
                key: options.keyOf?.(result) ?? key ?? null,
                error: null,
              });
          },
          (e: unknown) => {
            if (mine === latest) update({ ...state, status: "error", error: message(e) });
          },
        );
      }, delayMs);
    },
    cancel() {
      stop();
      if (state.status === "loading") update({ ...state, status: state.result ? "ready" : "idle" });
    },
  };
}
