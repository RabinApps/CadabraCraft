import {
  isSprintDone,
  pauseSprint,
  sprintRemainingMs,
  startSprint,
  type Sprint,
} from "@cadabracraft/shared";
import { useLingui } from "@lingui/react/macro";
import { Pause, Play, Timer } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { cx } from "../../../ui/cx";
import { IconButton } from "../../../ui/Button";
import { useSettings } from "../../../state/view/editorPrefs";
import { newSprint, sprintMinutes, type SprintMinutes } from "../../../state/view/sprintPrefs";
import { formatSprintClock } from "../../../state/view/sprintTime";
import { SprintPopover } from "./SprintPopover";

/** The current time, refreshed every second while the sprint runs; a stopped sprint does not tick. */
function useSprintNow(running: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [running]);
  return now;
}

/**
 * The sprint timer in the status bar: a chip with the time left (or Sprint done), a play or pause button, and a popover
 * with the length choice and Start, Pause, Reset. The sprint is an app preference; it is never written to the book.
 */
export function SprintControl() {
  const { t } = useLingui();
  const sprint = useSettings((s) => s.sprint);
  const set = useSettings((s) => s.set);
  const running = sprint.runningSince !== null;
  const now = useSprintNow(running);
  const [open, setOpen] = useState(false);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const panelId = useId();

  const done = isSprintDone(sprint, now);
  const started = running || sprint.elapsedMs > 0;
  const minutes = sprintMinutes(sprint);
  const clock = formatSprintClock(sprintRemainingMs(sprint, now));

  // The tick that reaches the end stops the sprint, so the finished state is kept after a reload or a tab switch.
  useEffect(() => {
    if (running && done) set({ sprint: pauseSprint(sprint, now) });
  }, [running, done, sprint, now, set]);

  // Escape closes the popover and returns focus to its chip.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setOpen(false);
      toggleRef.current?.focus();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  const update = (next: Sprint) => set({ sprint: next });
  const start = () => update(startSprint(done ? newSprint(minutes) : sprint, Date.now()));
  const pause = () => update(pauseSprint(sprint, Date.now()));
  const reset = () => update(newSprint(minutes));
  const choose = (m: SprintMinutes) => update(newSprint(m));

  const label = done
    ? t`Sprint done`
    : running
      ? t`${clock} left`
      : started
        ? t`${clock} paused`
        : t`Sprint ${clock}`;

  return (
    <div className="relative flex items-center gap-1">
      {/* Announced once, when the sprint finishes: the text is empty at every other time. */}
      <p aria-live="polite" className="sr-only">
        {done ? t`Sprint done. Nice work.` : ""}
      </p>
      <button
        ref={toggleRef}
        type="button"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        onClick={() => setOpen((o) => !o)}
        className={cx(
          "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-0.5 font-semibold tabular-nums max-md:min-h-11 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
          running || done
            ? "border-accent bg-accent-soft text-accent"
            : "border-border-strong text-ink-muted hover:bg-accent-soft",
        )}
      >
        <Timer size={14} aria-hidden />
        <span>{label}</span>
      </button>
      {!done && (
        <IconButton
          icon={running ? Pause : Play}
          label={running ? t`Pause sprint` : started ? t`Resume sprint` : t`Start sprint`}
          onClick={running ? pause : start}
        />
      )}
      {open && (
        <SprintPopover
          id={panelId}
          clock={clock}
          running={running}
          started={started}
          done={done}
          minutes={minutes}
          onStart={start}
          onPause={pause}
          onReset={reset}
          onChoose={choose}
        />
      )}
    </div>
  );
}
