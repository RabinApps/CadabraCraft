import { useRef } from "react";
import * as M from "@radix-ui/react-dropdown-menu";
import { useLingui } from "@lingui/react/macro";
import { ArrowDown, ArrowUp, Ellipsis, History, Pencil, Trash2 } from "lucide-react";
import type { LanguageRow } from "@cadabracraft/format";
import { Badge } from "../../ui/Badge";
import { IconButton } from "../../ui/Button";
import { cx } from "../../ui/cx";
import { menuContentClass, menuItemClass } from "../../ui/Menu";
import { SectionHeading } from "../../ui/SectionHeading";
import { useProject } from "../../state/project/index";
import { attempt } from "../../state/attempt";
import type { HistoryPage } from "../dialogs/HistoryDialog";

export type Editing = { id: string } | null;

interface ListProps {
  entries: LanguageRow[];
  heading: string;
  titleLabel: string;
  currentId: string | null;
  editing: Editing;
  setEditing: (e: Editing) => void;
  setDeleting: (d: { id: string; title: string }) => void;
  setHistory: (p: HistoryPage) => void;
  onNavigate?: () => void;
}

/** One section of the book (front matter, chapters or back matter): the same row, rename, reorder and trash actions in each. */
export function EntryList({
  entries,
  heading,
  titleLabel,
  currentId,
  editing,
  setEditing,
  setDeleting,
  setHistory,
  onNavigate,
}: ListProps) {
  const { t } = useLingui();
  const actions = useProject((s) => s.actions);
  const last = entries.length - 1;
  /** Rename, History and Trash run once the menu has closed, so the field or dialog they open can take focus; after any other item focus returns to the menu button. */
  const afterClose = useRef<(() => void) | null>(null);
  const moveFocus = (f: () => void) => () => void (afterClose.current = f);
  return (
    <section aria-label={heading} className="flex flex-col gap-0.5">
      <SectionHeading className="px-2.5 pt-1">{heading}</SectionHeading>
      <ul className="m-0 flex list-none flex-col gap-0.5 p-0">
        {entries.map((c, i) => {
          const current = c.id === currentId;
          return (
            <li
              key={c.id}
              className={cx(
                "group relative flex items-center gap-1 rounded-md ps-1",
                current && "bg-accent-soft",
              )}
            >
              {editing?.id === c.id ? (
                <input
                  autoFocus
                  aria-label={titleLabel}
                  defaultValue={c.title}
                  className="min-w-0 flex-1 rounded-md border border-border-strong bg-surface px-2 py-1.5 text-sm text-ink focus-visible:outline-2 focus-visible:outline-accent"
                  onBlur={(e) => {
                    setEditing(null);
                    // Escape cancels: closing the field can still blur it, which must not save.
                    if (e.target.dataset.cancelled) return;
                    if (e.target.value.trim() && e.target.value !== c.title)
                      attempt(actions.rename(c.id, e.target.value.trim()));
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") e.currentTarget.blur();
                    if (e.key === "Escape") {
                      e.currentTarget.dataset.cancelled = "true";
                      setEditing(null);
                    }
                  }}
                />
              ) : (
                <button
                  type="button"
                  aria-current={current ? "true" : undefined}
                  className={cx(
                    "min-w-0 flex-1 truncate rounded-md px-2 py-2.5 text-start text-sm text-ink focus-visible:outline-2 focus-visible:outline-accent md:py-2",
                    current && "font-semibold",
                  )}
                  onClick={() => {
                    attempt(actions.selectChapter(c.id));
                    onNavigate?.();
                  }}
                >
                  {c.title}
                </button>
              )}
              {!c.translated && <Badge tone="warn">{t`Not translated yet`}</Badge>}
              <M.Root>
                <M.Trigger asChild>
                  <IconButton
                    icon={Ellipsis}
                    label={t`Actions for ${c.title}`}
                    className="shrink-0 md:size-7"
                  />
                </M.Trigger>
                <M.Portal>
                  <M.Content
                    align="end"
                    onCloseAutoFocus={(e) => {
                      const next = afterClose.current;
                      afterClose.current = null;
                      if (next) e.preventDefault();
                      next?.();
                    }}
                    className={menuContentClass("min-w-44")}
                  >
                    <M.Item
                      className={menuItemClass()}
                      onSelect={moveFocus(() => setEditing({ id: c.id }))}
                    >
                      <Pencil size={14} aria-hidden />
                      {t`Rename`}
                    </M.Item>
                    <M.Item
                      className={menuItemClass()}
                      disabled={i === 0}
                      onSelect={() => attempt(actions.move(c.id, -1))}
                    >
                      <ArrowUp size={14} aria-hidden />
                      {t`Move up`}
                    </M.Item>
                    <M.Item
                      className={menuItemClass()}
                      disabled={i === last}
                      onSelect={() => attempt(actions.move(c.id, 1))}
                    >
                      <ArrowDown size={14} aria-hidden />
                      {t`Move down`}
                    </M.Item>
                    <M.Item
                      className={menuItemClass()}
                      onSelect={moveFocus(() =>
                        setHistory({ id: c.id, title: c.title, file: c.file }),
                      )}
                    >
                      <History size={14} aria-hidden />
                      {t`History`}
                    </M.Item>
                    <M.Item
                      className={menuItemClass("text-danger")}
                      onSelect={moveFocus(() => setDeleting({ id: c.id, title: c.title }))}
                    >
                      <Trash2 size={14} aria-hidden />
                      {t`Move to trash`}
                    </M.Item>
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
