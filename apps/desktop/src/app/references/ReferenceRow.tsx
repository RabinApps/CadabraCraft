import {
  File,
  FileText,
  GripVertical,
  Image,
  MoreHorizontal,
  Music,
  StickyNote,
  Video,
  type LucideIcon,
} from "lucide-react";
import * as M from "@radix-ui/react-dropdown-menu";
import { useId, type KeyboardEvent, type PointerEvent } from "react";
import type { Reference } from "@cadabracraft/format";
import { useLingui } from "@lingui/react/macro";
import { referenceKind, type ReferenceKind } from "../../lib/referenceKinds";
import { cx } from "../../ui/cx";
import { menuContentClass, menuItemClass } from "../../ui/Menu";

const ICONS: Record<ReferenceKind, LucideIcon> = {
  image: Image,
  video: Video,
  audio: Music,
  pdf: FileText,
  text: StickyNote,
  other: File,
};

export const kindIcon = (kind: ReferenceKind): LucideIcon => ICONS[kind];

/** The kind's name for the author ("Image", "PDF", "Document"). */
export function useKindLabel(): (kind: ReferenceKind) => string {
  const { t } = useLingui();
  return (kind) =>
    ({
      image: t`Image`,
      video: t`Video`,
      audio: t`Audio`,
      pdf: t`PDF`,
      text: t`Document`,
      other: t`File`,
    })[kind];
}

interface Props {
  reference: Reference;
  selected?: boolean;
  onOpen: () => void;
  /** Reordering: the grip starts a drag; Move up and Move down are the menu alternative. Absent while the list is filtered. */
  reorder?: {
    onGrab: (e: PointerEvent<HTMLElement>) => void;
    onMove: (delta: number) => void;
    first: boolean;
    last: boolean;
    dragging: boolean;
  };
  onRemove: () => void;
}

/** One reference in the list: a type icon, the title, and the kind with its tags. Opens the viewer; its menu moves or removes it. */
export function ReferenceRow({ reference, selected, onOpen, reorder, onRemove }: Props) {
  const { t } = useLingui();
  const kind = referenceKind(reference.file);
  const Icon = kindIcon(kind);
  const label = useKindLabel();
  const id = useId();
  const keys = (e: KeyboardEvent) => {
    if (!reorder || (e.key !== "ArrowUp" && e.key !== "ArrowDown")) return;
    e.preventDefault();
    const delta = e.key === "ArrowUp" ? -1 : 1;
    if (delta < 0 ? !reorder.first : !reorder.last) reorder.onMove(delta);
  };
  return (
    <div
      className={cx(
        "flex w-full items-center gap-1 rounded-md border p-2.5 transition-colors",
        reorder && "ps-1.5",
        reorder?.dragging && "border-accent bg-accent-soft opacity-40",
        !reorder?.dragging &&
          (selected
            ? "border-accent bg-accent-soft"
            : "border-border-strong bg-surface hover:bg-accent-soft/60"),
      )}
    >
      {reorder && (
        <button
          type="button"
          data-grip
          aria-label={t`Reorder ${reference.title}`}
          aria-keyshortcuts="ArrowUp ArrowDown"
          title={t`Drag, or press the up and down arrow keys`}
          onPointerDown={reorder.onGrab}
          onKeyDown={keys}
          className="flex size-6 shrink-0 cursor-grab touch-none items-center justify-center rounded-sm text-ink-muted focus-visible:outline-2 focus-visible:outline-accent"
        >
          <GripVertical size={16} aria-hidden />
        </button>
      )}
      <button
        type="button"
        onClick={onOpen}
        data-open
        aria-labelledby={`${id}-title`}
        aria-describedby={`${id}-kind`}
        className="flex min-w-0 flex-1 items-center gap-3 rounded-sm text-start focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
      >
        <span className="flex size-11 shrink-0 items-center justify-center rounded-sm bg-accent-soft text-accent">
          <Icon size={20} aria-hidden />
        </span>
        <span className="min-w-0 flex-1">
          <span
            id={`${id}-title`}
            data-title
            className="block truncate text-sm font-semibold text-ink"
          >
            {reference.title}
          </span>
          <span id={`${id}-kind`} className="block truncate text-xs text-ink-muted">
            {[label(kind), ...reference.tags].join(" · ")}
          </span>
        </span>
      </button>
      <M.Root>
        <M.Trigger asChild>
          <button
            type="button"
            aria-label={t`Actions for ${reference.title}`}
            className="flex size-8 shrink-0 items-center justify-center rounded-sm text-ink-muted hover:bg-accent-soft focus-visible:outline-2 focus-visible:outline-accent"
          >
            <MoreHorizontal size={16} aria-hidden />
          </button>
        </M.Trigger>
        <M.Portal>
          <M.Content align="end" className={menuContentClass("min-w-52")}>
            <M.Item className={menuItemClass()} onSelect={onOpen}>{t`Open`}</M.Item>
            <M.Item
              className={menuItemClass()}
              disabled={!reorder || reorder.first}
              onSelect={() => reorder?.onMove(-1)}
            >{t`Move up`}</M.Item>
            <M.Item
              className={menuItemClass()}
              disabled={!reorder || reorder.last}
              onSelect={() => reorder?.onMove(1)}
            >{t`Move down`}</M.Item>
            <M.Item className={menuItemClass("text-danger")} onSelect={onRemove}>
              {t`Remove from book`}
            </M.Item>
          </M.Content>
        </M.Portal>
      </M.Root>
    </div>
  );
}
