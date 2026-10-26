import { useState } from "react";
import * as M from "@radix-ui/react-dropdown-menu";
import { useLingui } from "@lingui/react/macro";
import { ArrowDown, ArrowUp, Ellipsis, GripVertical, Pencil, Plus, Trash2 } from "lucide-react";
import { Confirm } from "../ui/Dialog";
import { Button, IconButton } from "../ui/Button";
import { cx } from "../ui/cx";
import { useProject } from "./store";

const menuItem = "flex cursor-default items-center gap-2 rounded px-2.5 py-2 text-sm text-ink outline-none data-[disabled]:opacity-40 data-[highlighted]:bg-accent-soft";

export function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const { t } = useLingui();
  const { manifest, currentId, actions } = useProject();
  const [editing, setEditing] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<{ id: string; title: string } | null>(null);
  if (!manifest) return null;
  const last = manifest.chapters.length - 1;
  return (
    <nav aria-label={t`Chapters`} className="flex h-full flex-col gap-2 p-3">
      <h2 className="px-2.5 pt-1 text-[11px] font-bold uppercase tracking-[0.12em] text-ink-muted">{t`Chapters`}</h2>
      <ul className="m-0 flex min-h-0 flex-1 list-none flex-col gap-0.5 overflow-y-auto p-0">
        {manifest.chapters.map((c, i) => {
          const current = c.id === currentId;
          return (
            <li key={c.id} className={cx("group relative flex items-center gap-1 rounded-md ps-1", current && "bg-accent-soft")}>
              <GripVertical size={16} aria-hidden className={cx("shrink-0", current ? "text-accent" : "text-ink-muted")} />
              {editing === c.id ? (
                <input
                  autoFocus
                  aria-label={t`Chapter title`}
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
                    <M.Item className={menuItem} onSelect={() => setEditing(c.id)}><Pencil size={14} aria-hidden />{t`Rename`}</M.Item>
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
      <Button variant="ghost" icon={Plus} className="justify-start" onClick={() => void actions.add(t`Chapter ${manifest.chapters.length + 1}`)}>{t`Add chapter`}</Button>
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
