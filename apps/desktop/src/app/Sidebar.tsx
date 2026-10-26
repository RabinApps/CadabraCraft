import { useEffect, useState } from "react";
import * as M from "@radix-ui/react-dropdown-menu";
import { useLingui } from "@lingui/react/macro";
import { ArrowDown, ArrowUp, Ellipsis, FilePlus, GripVertical, Pencil, Plus, Trash2, Undo2 } from "lucide-react";
import { canAddMatter, type ManuscriptEntry } from "@cadabracraft/format";
import type { MatterKind } from "@cadabracraft/shared";
import { Confirm, Modal } from "../ui/Dialog";
import { Button, IconButton } from "../ui/Button";
import { cx } from "../ui/cx";
import { useProject } from "./store";

const menuItem = "flex cursor-default items-center gap-2 rounded px-2.5 py-2 text-sm text-ink outline-none data-[disabled]:opacity-40 data-[highlighted]:bg-accent-soft";

const FRONT_PRESETS: MatterKind[] = ["title-page", "copyright", "dedication", "epigraph", "foreword", "preface", "custom"];
const BACK_PRESETS: MatterKind[] = ["acknowledgments", "about-the-author", "also-by", "colophon", "custom"];

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

type Editing = { id: string } | null;

interface ListProps {
  entries: ManuscriptEntry[];
  heading: string;
  titleLabel: string;
  currentId: string | null;
  editing: Editing;
  setEditing: (e: Editing) => void;
  setDeleting: (d: { id: string; title: string }) => void;
  onNavigate?: () => void;
}

/** One section of the book (front matter, chapters or back matter): the same row, rename, reorder and trash actions in each. */
function EntryList({ entries, heading, titleLabel, currentId, editing, setEditing, setDeleting, onNavigate }: ListProps) {
  const { t } = useLingui();
  const { actions } = useProject();
  const last = entries.length - 1;
  return (
    <section aria-label={heading} className="flex flex-col gap-0.5">
      <h2 className="px-2.5 pt-1 text-[11px] font-bold uppercase tracking-[0.12em] text-ink-muted">{heading}</h2>
      <ul className="m-0 flex list-none flex-col gap-0.5 p-0">
        {entries.map((c, i) => {
          const current = c.id === currentId;
          return (
            <li key={c.id} className={cx("group relative flex items-center gap-1 rounded-md ps-1", current && "bg-accent-soft")}>
              <GripVertical size={16} aria-hidden className={cx("shrink-0", current ? "text-accent" : "text-ink-muted")} />
              {editing?.id === c.id ? (
                <input
                  autoFocus
                  aria-label={titleLabel}
                  defaultValue={c.title}
                  className="min-w-0 flex-1 rounded-md border border-border bg-surface px-2 py-1.5 text-sm text-ink focus-visible:outline-2 focus-visible:outline-accent"
                  onBlur={(e) => { setEditing(null); if (e.target.value.trim() && e.target.value !== c.title) void actions.rename(c.id, e.target.value.trim()); }}
                  onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); if (e.key === "Escape") setEditing(null); }}
                />
              ) : (
                <button
                  type="button"
                  aria-current={current ? "true" : undefined}
                  className={cx("min-w-0 flex-1 truncate rounded-md px-2 py-2.5 text-start text-sm text-ink focus-visible:outline-2 focus-visible:outline-accent md:py-2", current && "font-semibold")}
                  onClick={() => { void actions.selectChapter(c.id); onNavigate?.(); }}
                >
                  {c.title}
                </button>
              )}
              <M.Root>
                <M.Trigger asChild>
                  <IconButton icon={Ellipsis} label={t`Actions for ${c.title}`} className="shrink-0 md:size-7" />
                </M.Trigger>
                <M.Portal>
                  <M.Content align="end" onCloseAutoFocus={(e) => e.preventDefault()} className="z-50 min-w-44 rounded-md border border-border bg-raised p-1 text-ink shadow-xl">
                    <M.Item className={menuItem} onSelect={() => setEditing({ id: c.id })}><Pencil size={14} aria-hidden />{t`Rename`}</M.Item>
                    <M.Item className={menuItem} disabled={i === 0} onSelect={() => void actions.move(c.id, -1)}><ArrowUp size={14} aria-hidden />{t`Move up`}</M.Item>
                    <M.Item className={menuItem} disabled={i === last} onSelect={() => void actions.move(c.id, 1)}><ArrowDown size={14} aria-hidden />{t`Move down`}</M.Item>
                    <M.Item className={cx(menuItem, "text-danger")} onSelect={() => setDeleting({ id: c.id, title: c.title })}><Trash2 size={14} aria-hidden />{t`Move to trash`}</M.Item>
                  </M.Content>
                </M.Portal>
              </M.Root>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** Pages moved to the project trash, each with a Restore button. */
function TrashDialog({ open, onOpenChange, onNavigate }: { open: boolean; onOpenChange: (o: boolean) => void; onNavigate?: () => void }) {
  const { t } = useLingui();
  const { trash, actions } = useProject();
  const [error, setError] = useState("");
  const message = (e: unknown) => String(e instanceof Error ? e.message : e);
  useEffect(() => {
    if (!open) return;
    setError("");
    actions.refreshTrash().catch((e) => setError(message(e)));
  }, [open, actions]);
  return (
    <Modal open={open} onOpenChange={onOpenChange} title={t`Trash`} description={t`Pages you moved to the trash. Restoring puts a page back at the end of its section.`}>
      {error && <p role="alert" className="mb-2 text-sm text-danger">{error}</p>}
      {trash.length === 0 ? (
        <p className="text-sm text-ink-muted">{t`The trash is empty.`}</p>
      ) : (
        <ul className="m-0 flex max-h-72 list-none flex-col gap-1 overflow-y-auto p-0">
          {trash.map((x) => (
            <li key={x.path} className="flex items-center gap-2">
              <span className="min-w-0 flex-1 truncate text-sm text-ink">{x.title}</span>
              <Button
                icon={Undo2}
                aria-label={t`Restore ${x.title}`}
                onClick={() => { setError(""); void actions.restoreTrash(x.path).then(() => { onOpenChange(false); onNavigate?.(); }, (e) => setError(message(e))); }}
              >
                {t`Restore`}
              </Button>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}

export function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const { t } = useLingui();
  const { manifest, currentId, actions } = useProject();
  const [editing, setEditing] = useState<Editing>(null);
  const [deleting, setDeleting] = useState<{ id: string; title: string } | null>(null);
  const [trashOpen, setTrashOpen] = useState(false);
  const kinds = useKindLabels();
  if (!manifest) return null;
  const shared = { currentId, editing, setEditing, setDeleting, onNavigate };
  const preset = (section: "front" | "back", kind: MatterKind) => (
    <M.Item key={`${section}-${kind}`} className={menuItem} disabled={!canAddMatter(manifest, kind)} onSelect={() => { void actions.addMatter(section, kind).then(() => onNavigate?.(), () => {}); }}>
      {kinds[kind]}
    </M.Item>
  );
  return (
    <nav aria-label={t`Chapters`} className="flex h-full flex-col gap-2 p-3">
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto">
        {manifest.frontMatter.length > 0 && <EntryList {...shared} entries={manifest.frontMatter} heading={t`Front matter`} titleLabel={t`Page title`} />}
        <EntryList {...shared} entries={manifest.chapters} heading={t`Chapters`} titleLabel={t`Chapter title`} />
        {manifest.backMatter.length > 0 && <EntryList {...shared} entries={manifest.backMatter} heading={t`Back matter`} titleLabel={t`Page title`} />}
      </div>
      <Button variant="ghost" icon={Plus} className="justify-start" onClick={() => void actions.add(t`Chapter ${manifest.chapters.length + 1}`)}>{t`Add chapter`}</Button>
      <M.Root>
        <M.Trigger asChild>
          <Button variant="ghost" icon={FilePlus} className="justify-start">{t`Add page`}</Button>
        </M.Trigger>
        <M.Portal>
          <M.Content align="start" onCloseAutoFocus={(e) => e.preventDefault()} className="z-50 min-w-52 rounded-md border border-border bg-raised p-1 text-ink shadow-xl">
            <M.Group>
              <M.Label className="px-2.5 py-1 text-[11px] font-bold uppercase tracking-[0.12em] text-ink-muted">{t`Front matter`}</M.Label>
              {FRONT_PRESETS.map((k) => preset("front", k))}
            </M.Group>
            <M.Separator className="my-1 h-px bg-border" />
            <M.Group>
              <M.Label className="px-2.5 py-1 text-[11px] font-bold uppercase tracking-[0.12em] text-ink-muted">{t`Back matter`}</M.Label>
              {BACK_PRESETS.map((k) => preset("back", k))}
            </M.Group>
          </M.Content>
        </M.Portal>
      </M.Root>
      <Button variant="ghost" icon={Trash2} className="justify-start" onClick={() => setTrashOpen(true)}>{t`Trash`}</Button>
      <TrashDialog open={trashOpen} onOpenChange={setTrashOpen} onNavigate={onNavigate} />
      <Confirm
        open={deleting !== null}
        onOpenChange={(o) => { if (!o) setDeleting(null); }}
        title={t`Move “${deleting?.title ?? ""}” to trash?`}
        description={t`It moves to the project trash inside your book folder. Nothing is permanently deleted.`}
        confirmLabel={t`Move to trash`}
        danger
        onConfirm={() => { if (deleting) void actions.remove(deleting.id); }}
      />
    </nav>
  );
}
