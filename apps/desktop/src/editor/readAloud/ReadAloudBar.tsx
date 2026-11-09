import { useLingui } from "@lingui/react/macro";
import { Pause, Play, Square, TextCursor } from "lucide-react";
import { Button } from "../../ui/Button";
import { Select } from "../../ui/forms/Select";
import { AUDIO_SPEEDS } from "../../lib/audio/audioFormats";
import type { ReadAloud } from "./useReadAloud";

/**
 * The read-aloud bar under the formatting toolbar: play or pause, stop, read from the cursor, speed, and a status line.
 * The status line changes only at start, pause, stop and the end, so a screen reader announces each once.
 */
export function ReadAloudBar({
  state,
  line,
  speed,
  play,
  stop,
  readFromCursor,
  setSpeed,
}: ReadAloud) {
  const { t } = useLingui();
  const reading = state.status === "reading";
  const texts = {
    none: "",
    reading: t`Reading aloud`,
    paused: t`Read aloud paused`,
    stopped: t`Read aloud stopped`,
    edited: t`Read aloud stopped because the text changed`,
    done: t`Finished reading the chapter`,
    empty: t`There is nothing to read in this chapter`,
    cursor: t`Nothing to read after the cursor`,
    novoice: t`No voice on this computer reads this language. Download a voice in Export, Audiobook.`,
    error: line.kind === "error" ? line.message : "",
  };
  return (
    <div
      role="group"
      aria-label={t`Read aloud`}
      className="flex flex-wrap items-center gap-2 border-b border-border bg-raised px-3 py-1.5 text-ink"
    >
      <Button size="sm" variant="secondary" icon={reading ? Pause : Play} onClick={play}>
        {reading ? t`Pause` : t`Play`}
      </Button>
      <Button size="sm" variant="ghost" icon={Square} onClick={stop}>
        {t`Stop`}
      </Button>
      <Button size="sm" variant="ghost" icon={TextCursor} onClick={readFromCursor}>
        {t`Read from cursor`}
      </Button>
      <div className="w-24">
        <Select
          label={t`Speed`}
          hideLabel
          value={String(speed)}
          onChange={(e) => setSpeed(Number(e.target.value))}
        >
          {AUDIO_SPEEDS.map((v) => (
            <option key={v} value={String(v)}>
              {`${v}×`}
            </option>
          ))}
        </Select>
      </div>
      <p aria-live="polite" className="min-w-0 basis-full text-sm text-ink-muted md:basis-auto">
        {texts[line.kind]}
      </p>
    </div>
  );
}
