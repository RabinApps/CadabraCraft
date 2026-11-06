import { useLingui } from "@lingui/react/macro";
import { isStoryDate } from "@cadabracraft/editor-schema";
import { sceneWordsLabel } from "../../lib/scenes/scenes";
import {
  formatStoryDay,
  formatStoryTime,
  joinStoryDate,
  storyDay,
  storyTime,
  type TimelineItem,
} from "../../lib/scenes/timelineData";
import { cx } from "../../ui/cx";
import { sceneStatusTone, sceneStatusWord } from "../scenes/labels";

interface Props {
  item: TimelineItem;
  last: boolean;
  /** Saves the scene's whole story date (`field` names the input that changed, to put the focus back on it). */
  onDate: (date: string, field: "day" | "time") => void;
  onOpen: () => void;
}

const fieldClass =
  "rounded-md border border-border-strong bg-bg px-2 py-1.5 text-sm text-ink focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-60 max-md:min-h-11";

/** One scene on the axis: its date and time at the side, a marker on the line, and a card with the scene's notes and its date fields. */
export function TimelineRow({ item, last, onDate, onOpen }: Props) {
  const { t, i18n } = useLingui();
  const { scene, dated } = item;
  const title = scene.title || t`Untitled scene`;
  const day = storyDay(scene.date);
  const time = storyTime(scene.date);
  const tone = sceneStatusTone(scene.status);
  const chapterTitle = item.chapterTitle;
  const follows = item.follows;
  return (
    <li
      data-timeline-item
      data-scene-id={scene.id}
      className="grid grid-cols-[1rem_1fr] gap-x-3 [grid-template-areas:'axis_date'_'axis_card'] md:grid-cols-[8rem_1rem_1fr] md:gap-x-4 md:[grid-template-areas:'date_axis_card']"
    >
      <div className="pt-0.5 [grid-area:date] md:pt-[13px] md:text-end">
        {dated ? (
          <>
            <time dateTime={scene.date} className="block text-sm font-semibold">
              {formatStoryDay(scene.date, i18n.locale)}
            </time>
            {time && (
              <span className="block text-micro text-ink-muted">
                {formatStoryTime(scene.date, i18n.locale)}
              </span>
            )}
          </>
        ) : (
          <>
            <span className="block text-sm font-semibold text-ink-muted">{t`No date`}</span>
            {follows && (
              <span className="block text-micro text-ink-muted">{t`Follows ${follows}`}</span>
            )}
          </>
        )}
      </div>
      <div aria-hidden className="flex flex-col items-center pt-1.5 [grid-area:axis] md:pt-4">
        <span
          data-marker={dated ? "dated" : "undated"}
          className={cx(
            "size-3 shrink-0 rounded-full",
            dated ? "bg-accent" : "border-2 border-border-strong bg-bg",
          )}
        />
        {!last && <span className="mt-1 w-0.5 flex-1 bg-border" />}
      </div>
      <div className={cx("flex min-w-0 flex-col pt-2 [grid-area:card] md:pt-0", !last && "pb-4")}>
        <div
          data-scene-card
          className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-3"
        >
          <div className="flex items-start gap-2">
            <h3 className="min-w-0 flex-1 text-sm font-semibold break-words">{title}</h3>
            <button
              type="button"
              onClick={onOpen}
              aria-label={t`Open scene ${title} in ${chapterTitle}`}
              className="shrink-0 rounded-sm text-sm text-accent hover:underline focus-visible:outline-2 focus-visible:outline-accent max-md:min-h-11"
            >
              {t`Open`}
            </button>
          </div>
          <p className="text-micro text-ink-muted">
            {t`${chapterTitle} · ${sceneWordsLabel(scene)} words`}
          </p>
          {scene.synopsis && (
            <p className="font-book text-sm text-ink-muted break-words">{scene.synopsis}</p>
          )}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <div className="flex flex-wrap items-center gap-1.5">
              {scene.pov && (
                <span className="rounded-full border border-border px-2 py-0.5 text-micro font-semibold text-ink-muted">
                  {t`POV ${scene.pov}`}
                </span>
              )}
              {scene.status ? (
                <span
                  className={cx(
                    "rounded-full px-2 py-0.5 text-micro font-semibold",
                    tone === "warn" && "bg-warn-soft text-warn",
                    tone === "success" && "bg-success-soft text-success",
                    tone === "none" && "border border-border text-ink-muted",
                  )}
                >
                  {sceneStatusWord(scene.status)}
                </span>
              ) : null}
            </div>
            <div className="flex flex-wrap items-center gap-2 md:ms-auto">
              <input
                type="date"
                data-date-for={scene.id}
                data-field="day"
                // Saved when the field is left, not on every keystroke: a date typed digit by digit passes through other dates.
                key={`day-${scene.date}`}
                defaultValue={day}
                aria-label={t`Story date of ${title}`}
                onBlur={(e) => {
                  const next = joinStoryDate(e.target.value, e.target.value ? time : "");
                  if (next === scene.date || !(next === "" || isStoryDate(next))) return;
                  onDate(next, "day");
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") e.currentTarget.blur();
                }}
                className={fieldClass}
              />
              <input
                type="time"
                data-date-for={scene.id}
                data-field="time"
                key={`time-${scene.date}`}
                defaultValue={time}
                disabled={!day}
                aria-label={t`Story time of ${title}`}
                onBlur={(e) => {
                  const next = joinStoryDate(day, e.target.value);
                  if (!day || next === scene.date || !isStoryDate(next)) return;
                  onDate(next, "time");
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") e.currentTarget.blur();
                }}
                className={fieldClass}
              />
              {dated && (
                <button
                  type="button"
                  onClick={() => onDate("", "day")}
                  aria-label={t`Clear the story date of ${title}`}
                  className="rounded-sm text-sm text-accent hover:underline focus-visible:outline-2 focus-visible:outline-accent max-md:min-h-11"
                >
                  {t`Clear`}
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </li>
  );
}
