import { useLingui } from "@lingui/react/macro";
import { Pause, Play, RotateCcw } from "lucide-react";
import { useId } from "react";
import { Button } from "../../../ui/Button";
import { Chip } from "../../../ui/feedback/Chip";
import { Notice } from "../../../ui/feedback/Notice";
import { SPRINT_MINUTES, type SprintMinutes } from "../../../state/view/sprintPrefs";

interface Props {
  id: string;
  /** The time left as mm:ss. */
  clock: string;
  running: boolean;
  /** Started and not finished: the length is locked until Reset. */
  started: boolean;
  done: boolean;
  minutes: SprintMinutes;
  onStart: () => void;
  onPause: () => void;
  onReset: () => void;
  onChoose: (m: SprintMinutes) => void;
}

/** The sprint popover: the time, the state, the length choice and Start or Pause, and Reset. */
export function SprintPopover(p: Props) {
  const { t } = useLingui();
  const headingId = useId();
  const { running, started, done } = p;
  return (
    <section
      id={p.id}
      aria-labelledby={headingId}
      className="absolute end-0 bottom-full z-(--z-menu) mb-2 w-72 rounded-md border border-border bg-raised p-4 text-sm text-ink shadow-popover"
    >
      <h2 id={headingId} className="text-sm font-bold">
        {t`Sprint`}
      </h2>
      <p className="mt-2 text-center text-4xl font-semibold tabular-nums">{p.clock}</p>
      <div className="mt-2 text-center text-xs text-ink-muted">
        {done ? (
          <Notice tone="success">{t`Sprint done. Nice work.`}</Notice>
        ) : running ? (
          t`Running`
        ) : started ? (
          t`Paused`
        ) : (
          t`Ready when you are`
        )}
      </div>
      <div role="group" aria-label={t`Sprint length`} className="mt-3 flex gap-2">
        {SPRINT_MINUTES.map((m) => (
          <Chip
            key={m}
            pressed={m === p.minutes}
            disabled={started && !done}
            onClick={() => p.onChoose(m)}
          >
            {t`${m} min`}
          </Chip>
        ))}
      </div>
      <div className="mt-3 flex gap-2">
        {done ? (
          <Button variant="primary" icon={Play} onClick={p.onStart}>
            {t`Start again`}
          </Button>
        ) : running ? (
          <Button variant="primary" icon={Pause} onClick={p.onPause}>
            {t`Pause`}
          </Button>
        ) : (
          <Button variant="primary" icon={Play} onClick={p.onStart}>
            {started ? t`Resume` : t`Start`}
          </Button>
        )}
        <Button variant="secondary" icon={RotateCcw} onClick={p.onReset}>
          {t`Reset`}
        </Button>
      </div>
    </section>
  );
}
