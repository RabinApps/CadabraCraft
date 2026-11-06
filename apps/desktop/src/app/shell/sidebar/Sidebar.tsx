import { useEffect, useMemo, useState } from "react";
import * as M from "@radix-ui/react-dropdown-menu";
import { useLingui } from "@lingui/react/macro";
import { BookMarked, Camera, FilePlus, Layers, Plus, Redo2, Trash2, Undo2 } from "lucide-react";
import { canAddMatter, chaptersOf, entryRowsIn, sourceTitleById } from "@cadabracraft/format";
import type { MatterKind } from "@cadabracraft/shared";
import { Confirm } from "../../../ui/Dialog";
import { Button, IconButton } from "../../../ui/Button";
import { useProject } from "../../../state/project/index";
import { attempt } from "../../../state/attempt";
import { HistoryDialog, type HistoryPage } from "../../dialogs/HistoryDialog";
import { IconDialog, type IconPage } from "../../dialogs/IconDialog";
import { useKindLabels } from "../useKindLabels";
import { EntryList, type Editing } from "../EntryList";
import { SceneList } from "../../scenes/SceneList";
import { useChapterScenes } from "../../scenes/useChapterScenes";
import { sceneRows } from "../../../lib/scenes/scenes";
import { useSceneEditing } from "../../../lib/scenes/sceneEditing";
import { useSceneView } from "../../../state/view/sceneView";
import { TrashDialog } from "../TrashDialog";
import { CodexDialog } from "../../codex/CodexDialog";
import { menuContentClass, menuItemClass, menuLabelClass } from "../../../ui/Menu";

const FRONT_PRESETS: MatterKind[] = [
  "title-page",
  "copyright",
  "dedication",
  "epigraph",
  "contents",
  "foreword",
  "preface",
  "custom",
];
const BACK_PRESETS: MatterKind[] = [
  "acknowledgments",
  "about-the-author",
  "also-by",
  "colophon",
  "custom",
];

export function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const { t } = useLingui();
  const manifest = useProject((s) => s.manifest);
  const language = useProject((s) => s.activeLanguage ?? s.manifest?.editions[0]?.language ?? "");
  const currentId = useProject((s) => s.currentId);
  const currentDoc = useProject((s) => s.currentDoc);
  const scenes = useMemo(() => sceneRows(currentDoc), [currentDoc]);
  const activeScene = useSceneView((s) => s.active);
  const showScene = useSceneView((s) => s.show);
  // The open chapter starts expanded; any other chapter shows its scenes once it is expanded, read from its own file.
  const [openChapters, setOpenChapters] = useState<Set<string>>(new Set());
  const [collapsedParts, setCollapsedParts] = useState<Set<string>>(new Set());
  useEffect(() => {
    if (!currentId) return;
    setOpenChapters((prev) => (prev.has(currentId) ? prev : new Set(prev).add(currentId)));
  }, [currentId]);
  const otherIds = useMemo(
    () => [...openChapters].filter((id) => id !== currentId),
    [openChapters, currentId],
  );
  const otherScenes = useChapterScenes(otherIds);
  const rowsFor = (id: string) => (id === currentId ? scenes : (otherScenes[id] ?? []));
  const toggleRow = (id: string) =>
    setOpenChapters((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const togglePart = (id: string) =>
    setCollapsedParts((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const history = useProject((s) => s.history);
  const actions = useProject((s) => s.actions);
  const lastUndo = history.undo.at(-1);
  const lastRedo = history.redo.at(-1);
  const isMac = /Mac|iPhone|iPad/.test(navigator.platform);
  const [editing, setEditing] = useState<Editing>(null);
  const [deleting, setDeleting] = useState<{ id: string; title: string } | null>(null);
  const [trashOpen, setTrashOpen] = useState(false);
  const [codexOpen, setCodexOpen] = useState(false);
  const [versionsOf, setVersionsOf] = useState<HistoryPage | null>(null);
  const [iconOf, setIconOf] = useState<IconPage | null>(null);
  const [bookHistory, setBookHistory] = useState(false);
  const kinds = useKindLabels();
  if (!manifest) return null;
  const deletingPart =
    deleting !== null && manifest.chapters.some((e) => e.id === deleting.id && e.kind === "part");
  const shared = {
    currentId,
    editing,
    setEditing,
    setDeleting,
    setHistory: setVersionsOf,
    setIcon: setIconOf,
    onNavigate,
  };
  const preset = (section: "front" | "back", kind: MatterKind) => (
    <M.Item
      key={`${section}-${kind}`}
      className={menuItemClass()}
      disabled={!canAddMatter(manifest, kind)}
      onSelect={() => {
        attempt(actions.addMatter(section, kind).then(() => onNavigate?.()));
      }}
    >
      {kinds[kind]}
    </M.Item>
  );
  return (
    <nav aria-label={t`Chapters`} className="flex h-full flex-col gap-2 p-3">
      <div
        data-sidebar-entries
        className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto overscroll-y-contain"
      >
        {manifest.frontMatter.length > 0 && (
          <EntryList
            {...shared}
            entries={entryRowsIn(manifest.frontMatter, manifest.editions, language)}
            heading={t`Front matter`}
            titleLabel={t`Page title`}
            collapsible
          />
        )}
        <EntryList
          {...shared}
          entries={entryRowsIn(manifest.chapters, manifest.editions, language)}
          heading={t`Chapters`}
          chapters
          titleLabel={t`Chapter title`}
          openRows={openChapters}
          onToggleRow={toggleRow}
          collapsedParts={collapsedParts}
          onTogglePart={togglePart}
          underRow={(chapterId) => (
            <SceneList
              rows={rowsFor(chapterId)}
              chapter={sourceTitleById(manifest, chapterId) ?? undefined}
              active={activeScene}
              onOpen={(sceneId) => {
                if (chapterId === currentId) useSceneEditing.getState().open?.(sceneId);
                else attempt(actions.selectChapter(chapterId).then(() => showScene(sceneId)));
                showScene(sceneId);
                onNavigate?.();
              }}
              onAdd={
                chapterId === currentId
                  ? () => {
                      const id = useSceneEditing.getState().add?.();
                      if (id) showScene(id);
                    }
                  : undefined
              }
            />
          )}
        />
        {manifest.backMatter.length > 0 && (
          <EntryList
            {...shared}
            entries={entryRowsIn(manifest.backMatter, manifest.editions, language)}
            heading={t`Back matter`}
            titleLabel={t`Page title`}
            collapsible
          />
        )}
      </div>
      <div className="flex flex-col gap-1">
        <Button
          variant="ghost"
          icon={Plus}
          className="justify-start"
          onClick={() => attempt(actions.add(t`Chapter ${chaptersOf(manifest).length + 1}`))}
        >{t`Add chapter`}</Button>
        <Button
          variant="ghost"
          icon={Layers}
          className="justify-start"
          onClick={() =>
            attempt(
              actions.addPart(
                t`Part ${manifest.chapters.filter((e) => e.kind === "part").length + 1}`,
              ),
            )
          }
        >{t`Add part`}</Button>
      </div>
      <M.Root>
        <M.Trigger asChild>
          <Button variant="ghost" icon={FilePlus} className="justify-start">{t`Add page`}</Button>
        </M.Trigger>
        <M.Portal>
          <M.Content align="start" className={menuContentClass("min-w-52")}>
            {/* A blank page goes wherever the open page is: front matter, between two chapters or the back matter. */}
            <M.Item
              className={menuItemClass()}
              onSelect={() => attempt(actions.addBlank().then(() => onNavigate?.()))}
            >
              {kinds.blank}
            </M.Item>
            <M.Separator className="my-1 h-px bg-border" />
            <M.Group>
              <M.Label className={menuLabelClass}>{t`Front matter`}</M.Label>
              {FRONT_PRESETS.map((k) => preset("front", k))}
            </M.Group>
            <M.Separator className="my-1 h-px bg-border" />
            <M.Group>
              <M.Label className={menuLabelClass}>{t`Back matter`}</M.Label>
              {BACK_PRESETS.map((k) => preset("back", k))}
            </M.Group>
          </M.Content>
        </M.Portal>
      </M.Root>
      <Button
        variant="ghost"
        icon={Trash2}
        className="justify-start"
        onClick={() => setTrashOpen(true)}
      >{t`Trash`}</Button>
      <Button
        variant="ghost"
        icon={Camera}
        className="justify-start"
        onClick={() => setBookHistory(true)}
      >{t`Book snapshots`}</Button>
      <Button
        variant="ghost"
        icon={BookMarked}
        className="justify-start"
        onClick={() => setCodexOpen(true)}
      >{t`Codex`}</Button>
      <div role="group" aria-label={t`Book history`} className="flex items-center gap-1">
        <IconButton
          icon={Undo2}
          label={lastUndo ? t`Undo: ${lastUndo.label}` : t`Undo book change`}
          hint={isMac ? "⌘⌥Z" : "Ctrl+Alt+Z"}
          aria-keyshortcuts={isMac ? "Meta+Alt+Z" : "Control+Alt+Z"}
          disabled={!lastUndo}
          onClick={() => attempt(actions.undo())}
        />
        <IconButton
          icon={Redo2}
          label={lastRedo ? t`Redo: ${lastRedo.label}` : t`Redo book change`}
          hint={isMac ? "⌘⌥⇧Z" : "Ctrl+Alt+Shift+Z"}
          aria-keyshortcuts={isMac ? "Meta+Alt+Shift+Z" : "Control+Alt+Shift+Z"}
          disabled={!lastRedo}
          onClick={() => attempt(actions.redo())}
        />
      </div>
      <HistoryDialog
        page={versionsOf}
        open={versionsOf !== null || bookHistory}
        onOpenChange={(o) => {
          if (!o) {
            setVersionsOf(null);
            setBookHistory(false);
          }
        }}
        onNavigate={onNavigate}
      />
      <IconDialog page={iconOf} onClose={() => setIconOf(null)} />
      <TrashDialog open={trashOpen} onOpenChange={setTrashOpen} onNavigate={onNavigate} />
      <CodexDialog open={codexOpen} onOpenChange={setCodexOpen} />
      <Confirm
        open={deleting !== null}
        onOpenChange={(o) => {
          if (!o) setDeleting(null);
        }}
        title={
          deletingPart
            ? t`Remove ${deleting?.title ?? ""}`
            : t`Move “${deleting?.title ?? ""}” to trash?`
        }
        description={
          deletingPart
            ? t`The part page moves to the project trash. Its chapters stay in the book, under the part before it. Nothing is permanently deleted.`
            : t`It moves to the project trash inside your book folder. Nothing is permanently deleted.`
        }
        confirmLabel={deletingPart ? t`Remove part` : t`Move to trash`}
        onConfirm={() => {
          if (deleting) attempt(actions.remove(deleting.id));
        }}
      />
    </nav>
  );
}
