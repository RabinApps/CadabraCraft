import { Fragment, type MutableRefObject } from "react";
import { useLingui } from "@lingui/react/macro";
import { Button } from "../../ui/Button";
import { cx } from "../../ui/cx";
import { DropLine } from "../../ui/DropLine";
import type { useDragReorder } from "../../ui/useDragReorder";
import { SceneCard } from "./SceneCard";
import type { BoardChapter } from "./useBoardData";

/** A place on the board: a chapter and a place among its scenes (before the scene now at that place). */
export interface Landing {
  chapter: string;
  index: number;
}

type SceneCardProps = Parameters<typeof SceneCard>[0];

interface ColumnProps {
  chapter: BoardChapter;
  /** On a phone only the picked chapter is shown. */
  shown: boolean;
  columns: MutableRefObject<Map<string, HTMLElement>>;
  drag: ReturnType<typeof useDragReorder<Landing>>["drag"];
  gripHelpId: string;
  povNames: string[];
  moves: (index: number) => SceneCardProps["moves"];
  onGrab: (sceneId: string, index: number) => SceneCardProps["onGrab"];
  onPatch: (sceneId: string, patch: Parameters<SceneCardProps["onPatch"]>[0]) => void;
  onOpen: (sceneId: string) => void;
  onWrap: () => void;
}

/** Every word of the chapter on the board: its scenes and the text outside them. */
const boardWords = (c: BoardChapter) => c.rows.reduce((n, r) => n + r.words, c.unsortedWords);

/** One chapter of the board: its title, its scene cards with the drop line, and the loose text that can be wrapped into a scene. */
export function BoardColumn({
  chapter: c,
  shown,
  columns,
  drag,
  gripHelpId,
  povNames,
  moves,
  onGrab,
  onPatch,
  onOpen,
  onWrap,
}: ColumnProps) {
  const { t } = useLingui();
  return (
    <section
      key={c.id}
      aria-label={c.title}
      ref={(el) => {
        if (el) columns.current.set(c.id, el);
        else columns.current.delete(c.id);
      }}
      className={cx(
        "flex min-h-0 w-72 shrink-0 flex-col gap-2 max-md:w-full",
        !shown && "max-md:hidden",
      )}
    >
      <h2 className="flex items-baseline justify-between gap-2 px-1 text-sm font-semibold">
        <span className="min-w-0 truncate">{c.title}</span>
        <span className="shrink-0 text-caption font-normal text-ink-muted">
          {t`${c.rows.length} scenes · ${boardWords(c).toLocaleString()} words`}
        </span>
      </h2>
      <div className="min-h-0 flex-1 overflow-y-auto pb-4 pt-1.5">
        {!c.loaded ? (
          <p role="status" className="px-1 text-sm text-ink-muted">{t`Reading…`}</p>
        ) : (
          <ul
            aria-label={t`Scenes in ${c.title}`}
            className="m-0 flex list-none flex-col gap-3 p-0"
          >
            {c.rows.length === 0 && (
              <li className="px-1 text-sm text-ink-muted">{t`No scenes yet.`}</li>
            )}
            {c.rows.map((s, i) => (
              <Fragment key={s.id}>
                {drag && drag.at.chapter === c.id && drag.at.index === i && (
                  <li aria-hidden className="relative h-0">
                    <DropLine />
                  </li>
                )}
                <SceneCard
                  scene={s}
                  chapterTitle={c.title}
                  moves={moves(i)}
                  povNames={povNames}
                  dragging={drag?.id === s.id}
                  onGrab={onGrab(s.id, i)}
                  onPatch={(p) => onPatch(s.id, p)}
                  onOpen={() => onOpen(s.id)}
                  gripHelpId={gripHelpId}
                />
              </Fragment>
            ))}
            {drag && drag.at.chapter === c.id && drag.at.index >= c.rows.length && (
              <li aria-hidden className="relative h-0">
                <DropLine />
              </li>
            )}
            {c.unsortedWords > 0 && (
              <li
                data-unsorted
                className="flex flex-col gap-2 rounded-lg border border-dashed border-border-strong p-3"
              >
                <h3 className="text-sm font-semibold">{t`Unsorted`}</h3>
                <p className="text-caption text-ink-muted">
                  {t`${c.unsortedWords.toLocaleString()} words sit outside every scene.`}
                </p>
                <Button size="sm" onClick={onWrap}>
                  {t`Wrap into a scene`}
                </Button>
              </li>
            )}
          </ul>
        )}
      </div>
    </section>
  );
}
