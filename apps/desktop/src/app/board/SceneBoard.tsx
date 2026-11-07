import { useEffect, useId, useMemo, useState } from "react";
import { useLingui } from "@lingui/react/macro";
import { ArrowLeft, Layers } from "lucide-react";
import { IconButton } from "../../ui/Button";
import { Button } from "../../ui/Button";
import { Notice } from "../../ui/feedback/Notice";
import { Select } from "../../ui/forms/Select";
import { noticeIsAlert } from "../../state/project/util";
import { useProject } from "../../state/project/index";
import { useCodex } from "../../state/codex";
import { useSceneView } from "../../state/view/sceneView";
import { attempt } from "../../state/attempt";
import { BoardColumn } from "./BoardColumn";
import { useSceneMoves } from "./useSceneMoves";
import { StructureDialog } from "./StructureDialog";
import { useBoardData, type BoardChapter } from "./useBoardData";

function BoardHeader({
  chapters,
  shown,
  onPicked,
  onStructure,
  onBack,
}: {
  chapters: BoardChapter[];
  shown: BoardChapter | undefined;
  onPicked: (id: string) => void;
  onStructure: () => void;
  onBack: () => void;
}) {
  const { t } = useLingui();
  const notice = useProject((s) => s.notice);
  const isAlert = useProject(noticeIsAlert);
  return (
    <header className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-border bg-surface px-4 py-2">
      <IconButton icon={ArrowLeft} label={t`Back`} onClick={onBack} />
      <Layers size={16} aria-hidden className="text-ink-muted" />
      <h1 className="font-book text-base font-semibold">{t`Scene board`}</h1>
      <div className="flex min-w-0 flex-1 items-start gap-1 text-sm text-ink-muted">
        <span role="status" className="min-w-0 break-words empty:sr-only">
          {isAlert ? "" : notice}
        </span>
        <span role="alert" className="min-w-0 break-words font-semibold text-danger empty:sr-only">
          {isAlert ? notice : ""}
        </span>
      </div>
      {chapters.length > 0 && (
        <Button size="sm" onClick={() => onStructure()}>
          {t`Story structure`}
        </Button>
      )}
      <div className="md:hidden w-full">
        {shown && (
          <Select label={t`Chapter`} value={shown.id} onChange={(e) => onPicked(e.target.value)}>
            {chapters.map((c) => (
              <option key={c.id} value={c.id}>
                {c.title}
              </option>
            ))}
          </Select>
        )}
      </div>
    </header>
  );
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

  const { columns, drag, grab, movesOf } = useSceneMoves(chapters, setSaid);

  return (
    <div className="flex h-dvh flex-col bg-bg text-ink">
      <BoardHeader
        chapters={chapters}
        shown={shown}
        onPicked={setPicked}
        onStructure={() => setStructureOpen(true)}
        onBack={onBack}
      />
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
              <BoardColumn
                key={c.id}
                chapter={c}
                shown={c.id === shown?.id}
                columns={columns}
                drag={drag}
                gripHelpId={gripHelp}
                povNames={povNames}
                moves={(i) => movesOf(c, i, at)}
                onGrab={(sceneId, i) => grab(sceneId, { chapter: c.id, index: i })}
                onPatch={(sceneId, p) => patch(c.id, sceneId, p)}
                onOpen={(sceneId) => openScene(c.id, sceneId)}
                onWrap={() => wrap(c)}
              />
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
