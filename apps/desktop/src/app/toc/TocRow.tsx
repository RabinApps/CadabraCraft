import { useRef, type KeyboardEvent, type PointerEvent } from "react";
import * as M from "@radix-ui/react-dropdown-menu";
import { useLingui } from "@lingui/react/macro";
import { Ellipsis, Eye, EyeOff, GripVertical, Pencil, RotateCcw, Trash2 } from "lucide-react";
import { Badge } from "../../ui/Badge";
import { cx } from "../../ui/cx";
import { useGripHint } from "../../ui/GripHint";
import { menuContentClass, menuItemClass } from "../../ui/Menu";
import type { TocRow as Row } from "../../lib/tocView";

export interface TocRowActions {
  onGrab: (e: PointerEvent<HTMLElement>) => void;
  onMove: (delta: number) => void;
  onRename: (title: string) => void;
  onToggleHidden: () => void;
  onReset: () => void;
  onRemove: () => void;
  first: boolean;
  last: boolean;
  dragging: boolean;
}

interface Props extends TocRowActions {
  row: Row;
  /** Whether the page-number column is shown (the book's contents page has numbers on). */
  numbers: boolean;
  editing: boolean;
  setEditing: (on: boolean) => void;
}

/** One entry of the contents list: grip, indented title (double-click or Rename to edit in place), page number and an actions menu. */
export function TocRow({
  row,
  numbers,
  editing,
  setEditing,
  onGrab,
  onMove,
  onRename,
  onToggleHidden,
  onReset,
  onRemove,
  first,
  last,
  dragging,
}: Props) {
  const { t } = useLingui();
  const { item } = row;
  const grip = useGripHint();
  const custom = item.kind === "custom";
  const indent = item.indent ?? item.level;
  /** The rename field opens once the menu has closed, so it can take focus. */
  const afterClose = useRef<(() => void) | null>(null);
  const actions = useRef<HTMLButtonElement>(null);
  // The grip is the keyboard alternative to dragging (WCAG 2.5.7): the arrow keys move the entry one place.
  const keys = (e: KeyboardEvent) => {
    if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
    e.preventDefault();
    const delta = e.key === "ArrowUp" ? -1 : 1;
    if (delta < 0 ? !first : !last) onMove(delta);
  };
  return (
    <div
      data-toc-key={item.key}
      className={cx(
        "flex w-full items-center gap-1 rounded-md border p-1.5 ps-1.5 transition-colors",
        dragging ? "border-accent bg-accent-soft opacity-40" : "border-border bg-surface",
        item.hidden && !dragging && "bg-bg",
      )}
    >
      <button
        type="button"
        data-grip
        aria-label={t`Reorder ${item.title}`}
        aria-keyshortcuts="ArrowUp ArrowDown"
        aria-describedby={grip.describedBy}
        onPointerDown={onGrab}
        onKeyDown={keys}
        className="flex size-6 shrink-0 cursor-grab touch-none items-center justify-center rounded-sm text-ink-muted max-md:size-11 focus-visible:outline-2 focus-visible:outline-accent"
      >
        <GripVertical size={16} aria-hidden />
      </button>
      {grip.hint}
      <div
        className="flex min-w-0 flex-1 items-center gap-2"
        style={{ paddingInlineStart: indent * 16 }}
      >
        {editing ? (
          <input
            autoFocus
            aria-label={t`Entry title`}
            defaultValue={item.title}
            className="min-w-0 flex-1 rounded-md border border-border bg-surface px-2 py-1.5 text-sm text-ink focus-visible:outline-2 focus-visible:outline-accent"
            onBlur={(e) => {
              setEditing(false);
              // Escape cancels: closing the field can still blur it, which must not save.
              if (e.target.dataset.cancelled) return;
              const text = e.target.value.trim();
              if (text !== item.title && !(custom && text === "")) onRename(text);
            }}
            onKeyDown={(e) => {
              // Enter that confirms an input-method candidate (Japanese, Chinese, Korean) must not commit the half-typed title.
              if (e.nativeEvent.isComposing) return;
              // Both end the edit with focus back on the row's Actions button, so it is not lost when the field goes.
              if (e.key === "Enter") {
                e.currentTarget.blur();
                actions.current?.focus();
              }
              if (e.key === "Escape") {
                e.currentTarget.dataset.cancelled = "true";
                setEditing(false);
                actions.current?.focus();
              }
            }}
          />
        ) : (
          <span
            onDoubleClick={() => setEditing(true)}
            className={cx(
              "min-w-0 flex-1 truncate px-1 py-1 text-sm",
              item.level === 0 ? "font-semibold text-ink" : "text-ink",
              item.hidden && "text-ink-muted line-through",
            )}
          >
            {item.title}
          </span>
        )}
        {custom && <Badge tone="success">{t`Custom`}</Badge>}
        {item.stale && <Badge tone="warn">{t`Stale`}</Badge>}
        {item.hidden && <span className="text-xs text-ink-muted">{t`Hidden`}</span>}
      </div>
      {numbers && (
        <span data-toc-page className="w-14 shrink-0 text-end text-sm tabular-nums text-ink-muted">
          {row.text === null ? "–" : `${row.estimated ? "≈ " : ""}${row.text}`}
          {row.estimated && row.text !== null && <span className="sr-only"> {t`(estimated)`}</span>}
        </span>
      )}
      <M.Root>
        <M.Trigger asChild>
          <button
            ref={actions}
            type="button"
            data-actions
            aria-label={t`Actions for ${item.title}`}
            className="flex size-8 shrink-0 items-center justify-center rounded-sm text-ink-muted hover:bg-accent-soft focus-visible:outline-2 focus-visible:outline-accent max-md:size-11"
          >
            <Ellipsis size={16} aria-hidden />
          </button>
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
            className={menuContentClass("min-w-52")}
          >
            <M.Item
              className={menuItemClass()}
              onSelect={() => (afterClose.current = () => setEditing(true))}
            >
              <Pencil size={14} aria-hidden />
              {t`Rename`}
            </M.Item>
            <M.Item
              className={menuItemClass()}
              disabled={first}
              onSelect={() => onMove(-1)}
            >{t`Move up`}</M.Item>
            <M.Item
              className={menuItemClass()}
              disabled={last}
              onSelect={() => onMove(1)}
            >{t`Move down`}</M.Item>
            <M.Item className={menuItemClass()} onSelect={onToggleHidden}>
              {item.hidden ? <Eye size={14} aria-hidden /> : <EyeOff size={14} aria-hidden />}
              {item.hidden ? t`Show in contents` : t`Hide from contents`}
            </M.Item>
            {!custom && (item.renamed || item.hidden) && (
              <M.Item className={menuItemClass()} onSelect={onReset}>
                <RotateCcw size={14} aria-hidden />
                {t`Reset this entry`}
              </M.Item>
            )}
            {custom && (
              <M.Item className={menuItemClass("text-danger")} onSelect={onRemove}>
                <Trash2 size={14} aria-hidden />
                {t`Remove entry`}
              </M.Item>
            )}
          </M.Content>
        </M.Portal>
      </M.Root>
    </div>
  );
}
