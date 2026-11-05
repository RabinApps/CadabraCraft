import { Fragment, useEffect, useId, useMemo, useRef, useState } from "react";
import { useLingui } from "@lingui/react/macro";
import { ArrowLeft, Layers } from "lucide-react";
import { IconButton } from "../../ui/Button";
import { Button } from "../../ui/Button";
import { cx } from "../../ui/cx";
import { DropLine } from "../../ui/DropLine";
import { Notice } from "../../ui/Notice";
import { Select } from "../../ui/Select";
import { useDragReorder } from "../../ui/useDragReorder";
import { dropPosition, insertionIndex } from "../../lib/referenceKinds";
import { noticeIsAlert } from "../../state/project/util";
import { useProject } from "../../state/project/index";
import { useCodex } from "../../state/codex";
import { useSceneView } from "../../state/sceneView";
import { attempt } from "../../state/attempt";
import { SceneCard } from "./SceneCard";
import { StructureDialog } from "./StructureDialog";
import { useBoardData, type BoardChapter } from "./useBoardData";

/** Every word of the chapter on the board: its scenes and the text outside them. */
const boardWords = (c: BoardChapter) => c.rows.reduce((n, r) => n + r.words, c.unsortedWords);

/** Where a dragged card would land: a chapter and a place among its scenes (before the scene now at that place). */
interface Landing {
  chapter: string;
  index: number;
}

/**
 * The scene board: every chapter of the book as a column of scene cards, with each scene's synopsis, point of view, status
 * and words. Cards move within and across chapters by dragging the grip, with the grip's arrow keys, or from the card's menu;
 * every move or edit is one undo step. The chapters need not be open: edits go to the chapter files.
 */
export function SceneBoard({ onBack }: { onBack: () => void }) {
  const { t } = useLingui();
  const actions = useProject((s) => s.actions);
  const root = useProject((s) => s.root);
  const notice = useProject((s) => s.notice);
  const isAlert = useProject(noticeIsAlert);
  const entries = useCodex((s) => s.entries);
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
  useEffect(() => {
    if (root) void useCodex.getState().load(root);
  }, [root]);
  const povNames = useMemo(
    () => entries.filter((e) => e.kind === "character").map((e) => e.name),
    [entries],
  );
  const { chapters, duplicates } = useBoardData(ready);
  const [said, setSaid] = useState("");
  const [structureOpen, setStructureOpen] = useState(false);
  const gripHelp = useId();
  useEffect(() => {
    if (!said) return;
    const timer = setTimeout(() => setSaid(""), 4000);
    return () => clearTimeout(timer);
  }, [said]);
  // A phone shows one chapter at a time.
  const [picked, setPicked] = useState<string | null>(null);
  const shown = chapters.find((c) => c.id === picked) ?? chapters[0];
  // A card that moved is drawn again once its chapter files have been read, and moving a focused element in the page drops its focus:
  // for a moment after a move, each new reading puts the focus back on the grip of the card that moved.
  const refocus = useRef({ id: "", until: 0 });
  useEffect(() => {
    if (Date.now() > refocus.current.until) return;
    const grip = document.querySelector<HTMLElement>(
      `[data-grip-for="${CSS.escape(refocus.current.id)}"]`,
    );
    if (grip && document.activeElement !== grip) grip.focus();
  }, [chapters]);

  const columns = useRef(new Map<string, HTMLElement>());
  const { drag, grab } = useDragReorder<Landing>({
    locate: (x, y) => {
      let best: { id: string; el: HTMLElement; gap: number } | null = null;
      for (const [id, el] of columns.current) {
        const r = el.getBoundingClientRect();
        if (r.width === 0) continue; // a chapter the phone is not showing
        const gap = Math.max(r.left - x, x - r.right, 0);
        if (!best || gap < best.gap) best = { id, el, gap };
      }
      if (!best) return { chapter: "", index: 0 };
      const middles = [...best.el.querySelectorAll("[data-scene-card]")].map((card) => {
        const r = card.getBoundingClientRect();
        return r.top + r.height / 2;
      });
      return { chapter: best.id, index: insertionIndex(middles, y) };
    },
    onDrop: (id, at) => {
      if (!at.chapter) return;
      const from = chapters.find((c) => c.rows.some((r) => r.id === id));
      if (!from) return;
      const fromIndex = from.rows.findIndex((r) => r.id === id);
      const to = from.id === at.chapter ? dropPosition(fromIndex, at.index) : at.index;
      if (from.id === at.chapter && to === fromIndex) return;
      place(id, at.chapter, to);
    },
  });

  /** Moves a scene and says where it went (the grip keeps its name, so nothing else would say it moved). */
  const place = (sceneId: string, chapterId: string, index: number) => {
    const chapter = chapters.find((c) => c.id === chapterId);
    const scene = chapters.flatMap((c) => c.rows).find((r) => r.id === sceneId);
    if (!chapter || !scene) return;
    const title = scene.title || t`Untitled scene`;
    const chapterTitle = chapter.title;
    const same = chapter.rows.some((r) => r.id === sceneId);
    const count = chapter.rows.length + (same ? 0 : 1);
    const place = Math.min(index, count - 1) + 1;
    refocus.current = { id: sceneId, until: Date.now() + 2000 };
    attempt(
      actions.moveScene(sceneId, chapterId, index).then((moved) => {
        if (moved) setSaid(t`Moved ${title} to position ${place} of ${count} in ${chapterTitle}`);
      }),
    );
  };

  const patch = (
    chapterId: string,
    sceneId: string,
    p: Parameters<typeof actions.patchSceneIn>[2],
  ) => attempt(actions.patchSceneIn(chapterId, sceneId, p));

  const openScene = (chapterId: string, sceneId: string) =>
    attempt(
      actions.selectChapter(chapterId).then(() => {
        useSceneView.getState().show(sceneId);
        onBack();
      }),
    );

  const wrap = (c: BoardChapter) =>
    attempt(
      actions.wrapUnsortedIn(c.id).then((ids) => {
        const chapterTitle = c.title;
        const n = ids.length;
        setSaid(
          n ? t`Made ${n} scenes from the loose text in ${chapterTitle}` : t`Nothing to wrap`,
        );
      }),
    );

  const movesOf = (c: BoardChapter, i: number, at: number) => ({
    index: i,
    count: c.rows.length,
    chapters: chapters.filter((o) => o.id !== c.id).map((o) => ({ id: o.id, title: o.title })),
    step: (delta: -1 | 1) => {
      const scene = c.rows[i]!;
      const title = scene.title || t`Untitled scene`;
      if (i + delta < 0) return setSaid(t`${title} is already first in ${c.title}`);
      if (i + delta >= c.rows.length) return setSaid(t`${title} is already last in ${c.title}`);
      place(scene.id, c.id, i + delta);
    },
    beside: (delta: -1 | 1) => {
      const next = chapters[at + delta];
      const title = c.rows[i]!.title || t`Untitled scene`;
      if (!next)
        return setSaid(
          delta < 0
            ? t`${title} is already in the first chapter`
            : t`${title} is already in the last chapter`,
        );
      place(c.rows[i]!.id, next.id, Math.min(i, next.rows.length));
    },
    toChapter: (chapterId: string) => {
      const next = chapters.find((o) => o.id === chapterId);
      if (next) place(c.rows[i]!.id, next.id, next.rows.length);
    },
  });

  return (
    <div className="flex h-dvh flex-col bg-bg text-ink">
      <header className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-border bg-surface px-4 py-2">
        <IconButton icon={ArrowLeft} label={t`Back`} onClick={onBack} />
        <Layers size={16} aria-hidden className="text-ink-muted" />
        <h1 className="font-book text-base font-semibold">{t`Scene board`}</h1>
        <div className="flex min-w-0 flex-1 items-start gap-1 text-sm text-ink-muted">
          <span role="status" className="min-w-0 break-words empty:sr-only">
            {isAlert ? "" : notice}
          </span>
          <span
            role="alert"
            className="min-w-0 break-words font-semibold text-danger empty:sr-only"
          >
            {isAlert ? notice : ""}
          </span>
        </div>
        {chapters.length > 0 && (
          <Button size="sm" onClick={() => setStructureOpen(true)}>
            {t`Story structure`}
          </Button>
        )}
        <div className="md:hidden w-full">
          {shown && (
            <Select label={t`Chapter`} value={shown.id} onChange={(e) => setPicked(e.target.value)}>
              {chapters.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.title}
                </option>
              ))}
            </Select>
          )}
        </div>
      </header>
      <main id="main" tabIndex={-1} className="flex min-h-0 flex-1 flex-col outline-none">
        {duplicates.length > 0 && (
          <Notice tone="warn" className="m-4 mb-0">
            {t`A scene is in two chapters, probably because a move was interrupted. Only the first is shown; Undo finishes the move.`}
          </Notice>
        )}
        {chapters.length === 0 ? (
          <p className="p-6 text-sm text-ink-muted">{t`This book has no chapters yet.`}</p>
        ) : (
          <div
            role="region"
            aria-label={t`Chapters and their scenes`}
            className="flex min-h-0 flex-1 gap-4 overflow-x-auto overflow-y-hidden p-4"
          >
            {chapters.map((c, at) => (
              <section
                key={c.id}
                aria-label={c.title}
                ref={(el) => {
                  if (el) columns.current.set(c.id, el);
                  else columns.current.delete(c.id);
                }}
                className={cx(
                  "flex min-h-0 w-72 shrink-0 flex-col gap-2 max-md:w-full",
                  c.id !== shown?.id && "max-md:hidden",
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
                            moves={movesOf(c, i, at)}
                            povNames={povNames}
                            dragging={drag?.id === s.id}
                            onGrab={grab(s.id, { chapter: c.id, index: i })}
                            onPatch={(p) => patch(c.id, s.id, p)}
                            onOpen={() => openScene(c.id, s.id)}
                            gripHelpId={gripHelp}
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
                          <Button size="sm" onClick={() => wrap(c)}>
                            {t`Wrap into a scene`}
                          </Button>
                        </li>
                      )}
                    </ul>
                  )}
                </div>
              </section>
            ))}
          </div>
        )}
        <StructureDialog
          open={structureOpen}
          onOpenChange={setStructureOpen}
          chapters={chapters.map((c) => ({ id: c.id, title: c.title }))}
          defaultChapterId={shown?.id ?? ""}
          onAdded={setSaid}
        />
        <p id={gripHelp} className="sr-only">
          {t`Drag to move, or press the arrow keys: up and down move within the chapter, left and right to the next chapter. Escape cancels a drag.`}
        </p>
        <p aria-live="polite" className="sr-only">
          {said}
        </p>
      </main>
    </div>
  );
}
