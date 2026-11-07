import { useEffect, useMemo, useRef, useState } from "react";
import { useLingui } from "@lingui/react/macro";
import { ArrowLeft, CalendarRange, SearchX } from "lucide-react";
import { Button, IconButton } from "../../ui/Button";
import { Notice } from "../../ui/feedback/Notice";
import { Segmented } from "../../ui/forms/Segmented";
import { noticeIsAlert } from "../../state/project/util";
import { useProject } from "../../state/project/index";
import { useSceneView } from "../../state/view/sceneView";
import { attempt } from "../../state/attempt";
import { buildTimeline, formatStoryDay, type TimelineOrder } from "../../lib/scenes/timelineData";
import { useSceneFilter } from "../../state/view/sceneFilter";
import { boardRows, filterTimeline } from "../../lib/scenes/sceneFilter";
import { useBoardData } from "../board/useBoardData";
import { SceneFilterBar } from "../scenes/SceneFilterBar";
import { TimelineRow } from "./TimelineRow";

function TimelineHeader({
  order,
  onOrder,
  onBack,
}: {
  order: TimelineOrder;
  onOrder: (order: TimelineOrder) => void;
  onBack: () => void;
}) {
  const { t } = useLingui();
  const notice = useProject((s) => s.notice);
  const isAlert = useProject(noticeIsAlert);
  return (
    <header className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-border bg-surface px-4 py-2">
      <IconButton icon={ArrowLeft} label={t`Back`} onClick={onBack} />
      <CalendarRange size={16} aria-hidden className="text-ink-muted" />
      <h1 className="font-book text-base font-semibold">{t`Timeline`}</h1>
      <div className="flex min-w-0 flex-1 items-start gap-1 text-sm text-ink-muted">
        <span role="status" className="min-w-0 break-words empty:sr-only">
          {isAlert ? "" : notice}
        </span>
        <span role="alert" className="min-w-0 break-words font-semibold text-danger empty:sr-only">
          {isAlert ? notice : ""}
        </span>
      </div>
      <Segmented<TimelineOrder>
        label={t`Order`}
        value={order}
        onChange={onOrder}
        items={[
          { value: "book", label: t`Book order` },
          { value: "story", label: t`Story date` },
        ]}
      />
    </header>
  );
}

/**
 * The timeline: every scene of the book on one axis, in book order or by story date. A scene's story date is edited on its row
 * (a calendar day and an optional time); the chapters need not be open, the date goes to the chapter file like the board's edits,
 * as one undo step. Scenes are moved on the scene board, not here.
 */
export function Timeline({ onBack }: { onBack: () => void }) {
  const { t, i18n } = useLingui();
  const actions = useProject((s) => s.actions);
  // The chapter files are read once typing in the open chapter has been written.
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let live = true;
    void actions
      .flush()
      .catch(() => {})
      .then(() => live && setReady(true));
    return () => {
      live = false;
    };
  }, [actions]);
  const board = useBoardData(ready);
  const [order, setOrder] = useState<TimelineOrder>("book");
  const { filter, colourBy, clear } = useSceneFilter();
  const everyItem = useMemo(() => buildTimeline(board, order), [board, order]);
  // Filtered after the axis is built, so a scene without a date still follows the scene before it in the book.
  const items = useMemo(() => filterTimeline(everyItem, filter), [everyItem, filter]);
  const rows = useMemo(() => boardRows(board), [board]);
  const reading = !ready || board.chapters.some((c) => !c.loaded);
  const [said, setSaid] = useState("");
  useEffect(() => {
    if (!said) return;
    const timer = setTimeout(() => setSaid(""), 4000);
    return () => clearTimeout(timer);
  }, [said]);
  // A row that moved (its date changed the order) is drawn again once the files have been read, and moving a focused element drops
  // its focus: for a moment after a change, each new reading puts the focus back on the field that was edited.
  const refocus = useRef({ id: "", field: "", until: 0 });
  useEffect(() => {
    if (Date.now() > refocus.current.until) return;
    const field = document.querySelector<HTMLElement>(
      `[data-date-for="${CSS.escape(refocus.current.id)}"][data-field="${refocus.current.field}"]`,
    );
    if (field && document.activeElement !== field) field.focus();
  }, [items]);

  const setDate = (
    chapterId: string,
    sceneId: string,
    title: string,
    date: string,
    field: string,
  ) => {
    refocus.current = { id: sceneId, field, until: Date.now() + 2000 };
    attempt(
      actions.patchSceneIn(chapterId, sceneId, { date }).then((done) => {
        if (!done) return;
        setSaid(
          date
            ? t`Story date of ${title} set to ${formatStoryDay(date, i18n.locale)}`
            : t`Story date of ${title} cleared`,
        );
      }),
    );
  };

  const openScene = (chapterId: string, sceneId: string) =>
    attempt(
      actions.selectChapter(chapterId).then(() => {
        useSceneView.getState().show(sceneId);
        onBack();
      }),
    );

  const undated = items.filter((i) => !i.dated).length;
  return (
    <div className="flex h-dvh flex-col bg-bg text-ink">
      <TimelineHeader order={order} onOrder={setOrder} onBack={onBack} />
      <SceneFilterBar rows={rows} shown={items.length} />
      <main id="main" tabIndex={-1} className="min-h-0 flex-1 overflow-y-auto outline-none">
        <div className="mx-auto flex max-w-4xl flex-col gap-4 p-4 md:p-6">
          {board.duplicates.length > 0 && (
            <Notice tone="warn">
              {t`A scene is in two chapters, probably because a move was interrupted. Only the first is shown; Undo finishes the move.`}
            </Notice>
          )}
          {!reading && items.length > 0 && (
            <p className="text-sm text-ink-muted">
              {order === "story"
                ? t`Scenes are ordered by story date. A scene without a date stays behind the scene before it in the book.`
                : t`Scenes are in book order. Switch to Story date to order them by when they happen.`}
              {undated > 0 && ` ${t`${undated} without a story date.`}`}
            </p>
          )}
          {reading ? (
            <p role="status" className="text-sm text-ink-muted">{t`Reading…`}</p>
          ) : everyItem.length === 0 ? (
            <p className="text-sm text-ink-muted">{t`This book has no scenes yet.`}</p>
          ) : items.length === 0 ? (
            <div className="flex flex-col items-start gap-3 text-sm text-ink-muted">
              <SearchX size={24} aria-hidden />
              <p>{t`No scenes match these filters.`}</p>
              <Button onClick={clear}>{t`Clear filters`}</Button>
            </div>
          ) : (
            <ol aria-label={t`Scenes on the timeline`} className="m-0 flex list-none flex-col p-0">
              {items.map((item, i) => (
                <TimelineRow
                  key={item.scene.id}
                  item={item}
                  last={i === items.length - 1}
                  colourBy={colourBy}
                  onDate={(date, field) =>
                    setDate(
                      item.chapterId,
                      item.scene.id,
                      item.scene.title || t`Untitled scene`,
                      date,
                      field,
                    )
                  }
                  onOpen={() => openScene(item.chapterId, item.scene.id)}
                />
              ))}
            </ol>
          )}
        </div>
        <p aria-live="polite" className="sr-only">
          {said}
        </p>
      </main>
    </div>
  );
}
