import { useState } from "react";
import * as M from "@radix-ui/react-dropdown-menu";
import { useLingui } from "@lingui/react/macro";
import { FilePlus, Plus, Redo2, Trash2, Undo2 } from "lucide-react";
import { canAddMatter, entryRowsIn } from "@cadabracraft/format";
import type { MatterKind } from "@cadabracraft/shared";
import { Confirm } from "../../ui/Dialog";
import { Button, IconButton } from "../../ui/Button";
import { useProject } from "../../state/project/index";
import { attempt } from "../../state/attempt";
import { HistoryDialog, type HistoryPage } from "../dialogs/HistoryDialog";
import { EntryList, type Editing } from "./EntryList";
import { TrashDialog } from "./TrashDialog";
import { menuContentClass, menuItemClass, menuLabelClass } from "../../ui/Menu";

const FRONT_PRESETS: MatterKind[] = [
  "title-page",
  "copyright",
  "dedication",
  "epigraph",
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

/** Menu label of a page preset. Literal strings so Lingui can extract them. */
function useKindLabels() {
  const { t } = useLingui();
  const labels: Record<MatterKind, string> = {
    "title-page": t`Title page`,
    copyright: t`Copyright page`,
    dedication: t`Dedication`,
    epigraph: t`Epigraph`,
    foreword: t`Foreword`,
    preface: t`Preface`,
    custom: t`Custom page`,
    acknowledgments: t`Acknowledgments`,
    "about-the-author": t`About the author`,
    "also-by": t`Also by`,
    colophon: t`Colophon`,
  };
  return labels;
}

export function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const { t } = useLingui();
  const manifest = useProject((s) => s.manifest);
  const language = useProject((s) => s.activeLanguage ?? s.manifest?.editions[0]?.language ?? "");
  const currentId = useProject((s) => s.currentId);
  const history = useProject((s) => s.history);
  const actions = useProject((s) => s.actions);
  const lastUndo = history.undo.at(-1);
  const lastRedo = history.redo.at(-1);
  const isMac = /Mac|iPhone|iPad/.test(navigator.platform);
  const [editing, setEditing] = useState<Editing>(null);
  const [deleting, setDeleting] = useState<{ id: string; title: string } | null>(null);
  const [trashOpen, setTrashOpen] = useState(false);
  const [versionsOf, setVersionsOf] = useState<HistoryPage | null>(null);
  const kinds = useKindLabels();
  if (!manifest) return null;
  const shared = {
    currentId,
    editing,
    setEditing,
    setDeleting,
    setHistory: setVersionsOf,
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
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto">
        {manifest.frontMatter.length > 0 && (
          <EntryList
            {...shared}
            entries={entryRowsIn(manifest.frontMatter, manifest.editions, language)}
            heading={t`Front matter`}
            titleLabel={t`Page title`}
          />
        )}
        <EntryList
          {...shared}
          entries={entryRowsIn(manifest.chapters, manifest.editions, language)}
          heading={t`Chapters`}
          titleLabel={t`Chapter title`}
        />
        {manifest.backMatter.length > 0 && (
          <EntryList
            {...shared}
            entries={entryRowsIn(manifest.backMatter, manifest.editions, language)}
            heading={t`Back matter`}
            titleLabel={t`Page title`}
          />
        )}
      </div>
      <Button
        variant="ghost"
        icon={Plus}
        className="justify-start"
        onClick={() => attempt(actions.add(t`Chapter ${manifest.chapters.length + 1}`))}
      >{t`Add chapter`}</Button>
      <M.Root>
        <M.Trigger asChild>
          <Button variant="ghost" icon={FilePlus} className="justify-start">{t`Add page`}</Button>
        </M.Trigger>
        <M.Portal>
          <M.Content align="start" className={menuContentClass("min-w-52")}>
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
      <div role="group" aria-label={t`Book history`} className="flex items-center gap-1">
        <IconButton
          icon={Undo2}
          label={lastUndo ? t`Undo: ${lastUndo.label}` : t`Undo book change`}
          title={`${lastUndo ? t`Undo: ${lastUndo.label}` : t`Undo book change`} (${isMac ? "⌘⌥Z" : "Ctrl+Alt+Z"})`}
          disabled={!lastUndo}
          onClick={() => attempt(actions.undo())}
        />
        <IconButton
          icon={Redo2}
          label={lastRedo ? t`Redo: ${lastRedo.label}` : t`Redo book change`}
          title={`${lastRedo ? t`Redo: ${lastRedo.label}` : t`Redo book change`} (${isMac ? "⌘⌥⇧Z" : "Ctrl+Alt+Shift+Z"})`}
          disabled={!lastRedo}
          onClick={() => attempt(actions.redo())}
        />
      </div>
      <HistoryDialog
        page={versionsOf}
        open={versionsOf !== null}
        onOpenChange={(o) => {
          if (!o) setVersionsOf(null);
        }}
        onNavigate={onNavigate}
      />
      <TrashDialog open={trashOpen} onOpenChange={setTrashOpen} onNavigate={onNavigate} />
      <Confirm
        open={deleting !== null}
        onOpenChange={(o) => {
          if (!o) setDeleting(null);
        }}
        title={t`Move “${deleting?.title ?? ""}” to trash?`}
        description={t`It moves to the project trash inside your book folder. Nothing is permanently deleted.`}
        confirmLabel={t`Move to trash`}
        onConfirm={() => {
          if (deleting) attempt(actions.remove(deleting.id));
        }}
      />
    </nav>
  );
}
