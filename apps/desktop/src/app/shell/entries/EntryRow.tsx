import type { KeyboardEvent, MutableRefObject, PointerEvent } from "react";
import { useLingui } from "@lingui/react/macro";
import { plural } from "@lingui/core/macro";
import { ChevronDown, ChevronRight, GripVertical, Layers } from "lucide-react";
import type { LanguageRow } from "@cadabracraft/format";
import { Badge } from "../../../ui/feedback/Badge";
import { cx } from "../../../ui/cx";
import { DropLine } from "../../../ui/DropLine";
import { useProject } from "../../../state/project/index";
import { attempt } from "../../../state/attempt";
import { iconComponent } from "../../../lib/chapterIcons";
import type { ListProps } from "../EntryList";
import { RenameField } from "./RenameField";
import { RowMenu } from "./RowMenu";

/** What every row of a list shares: the list's own props that the row needs. */
export type SharedRowProps = Pick<
  ListProps,
  | "chapters"
  | "titleLabel"
  | "editing"
  | "setEditing"
  | "setDeleting"
  | "setHistory"
  | "setIcon"
  | "onNavigate"
  | "underRow"
  | "openRows"
  | "onToggleRow"
  | "onTogglePart"
>;

interface RowProps {
  row: LanguageRow;
  index: number;
  /** How many rows the list has. */
  total: number;
  current: boolean;
  /** Whether the row shows what sits under it (a chapter's scenes, a part's chapters). */
  open: boolean;
  /** A chapter inside a part is indented. */
  indented: boolean;
  /** For a part: how many chapters it holds. */
  count: number | undefined;
  drag: { id: string; at: number } | null;
  partIndexes: number[];
  afterClose: MutableRefObject<(() => void) | null>;
  gripHelp: string;
  onGrab: (e: PointerEvent<HTMLElement>) => void;
  onGripKeys: (e: KeyboardEvent) => void;
  step: (i: number, delta: -1 | 1) => void;
  say: (message: string) => void;
  shared: SharedRowProps;
}

const chevronClass =
  "flex size-5 shrink-0 items-center justify-center rounded-sm text-ink-muted hover:bg-raised focus-visible:outline-2 focus-visible:outline-accent max-md:size-11";

/** The chevron that opens and closes a part's chapters or a chapter's scenes, when the list offers one. */
function RowToggle({
  row: c,
  open,
  shared,
}: {
  row: LanguageRow;
  open: boolean;
  shared: SharedRowProps;
}) {
  const { t } = useLingui();
  const { onTogglePart, onToggleRow } = shared;
  const part = c.kind === "part";
  const toggle = part ? onTogglePart : onToggleRow;
  if (!toggle) return null;
  const label = part
    ? open
      ? t`Hide chapters of ${c.title}`
      : t`Show chapters of ${c.title}`
    : open
      ? t`Hide scenes of ${c.title}`
      : t`Show scenes of ${c.title}`;
  return (
    <button
      type="button"
      aria-expanded={open}
      aria-label={label}
      onClick={() => toggle(c.id)}
      className={chevronClass}
    >
      {open ? <ChevronDown size={14} aria-hidden /> : <ChevronRight size={14} aria-hidden />}
    </button>
  );
}

/** The grip of a page (the keyboard alternative to dragging), or the layers mark of a part. */
function RowGrip({
  row: c,
  gripHelp,
  onGrab,
  onGripKeys,
}: Pick<RowProps, "gripHelp" | "onGrab" | "onGripKeys"> & { row: LanguageRow }) {
  const { t } = useLingui();
  if (c.kind === "part")
    return (
      <span aria-hidden className="flex size-6 shrink-0 items-center justify-center text-ink-muted">
        <Layers size={15} />
      </span>
    );
  return (
    <button
      type="button"
      data-grip
      aria-label={t`Reorder ${c.title}`}
      aria-keyshortcuts="ArrowUp ArrowDown"
      aria-describedby={gripHelp}
      onPointerDown={onGrab}
      onKeyDown={onGripKeys}
      className="flex size-6 shrink-0 cursor-grab touch-none items-center justify-center rounded-sm text-ink-muted max-md:size-11 focus-visible:outline-2 focus-visible:outline-accent"
    >
      <GripVertical size={16} aria-hidden />
    </button>
  );
}

/** The title that opens the page, or the rename field while it is being renamed. */
function RowTitle({
  row: c,
  current,
  count,
  shared,
}: {
  row: LanguageRow;
  current: boolean;
  count: number | undefined;
  shared: SharedRowProps;
}) {
  const actions = useProject((s) => s.actions);
  const { editing, setEditing, titleLabel, onNavigate } = shared;
  if (editing?.id === c.id)
    return <RenameField row={c} titleLabel={titleLabel} setEditing={setEditing} />;
  const Icon = iconComponent(c.icon);
  return (
    <button
      type="button"
      aria-current={current ? "true" : undefined}
      className={cx(
        "min-w-0 flex-1 truncate rounded-md px-2 py-2.5 text-start text-sm text-ink focus-visible:outline-2 focus-visible:outline-accent md:py-2",
        (current || c.kind === "part") && "font-semibold",
      )}
      onClick={() => {
        attempt(actions.selectChapter(c.id));
        onNavigate?.();
      }}
    >
      {Icon && <Icon size={14} aria-hidden className="me-2 inline shrink-0 align-[-2px]" />}
      {c.title}
      {c.kind === "part" && (count ?? 0) > 0 && (
        <span className="ms-2 text-xs font-normal text-ink-muted">
          {plural(count ?? 0, { one: "# chapter", other: "# chapters" })}
        </span>
      )}
    </button>
  );
}

/** One page (or part divider) of a list: toggle, grip, title, translation badge and actions menu, with what sits under it. */
export function EntryRow({
  row: c,
  index: i,
  total,
  current,
  open,
  indented,
  count,
  drag,
  partIndexes,
  afterClose,
  gripHelp,
  onGrab,
  onGripKeys,
  step,
  say,
  shared,
}: RowProps) {
  const { t } = useLingui();
  const last = total - 1;
  return (
    <li
      className={cx(
        "group relative flex flex-col rounded-md",
        current && "bg-accent-soft",
        drag?.id === c.id && "opacity-40",
        c.kind === "part" && "mt-2 border-t border-border pt-1",
      )}
    >
      {drag && drag.at === i && <DropLine />}
      {drag && drag.at === total && i === last && <DropLine below />}{" "}
      <div
        className="flex items-center gap-1 ps-1"
        style={indented ? { paddingInlineStart: "1.25rem" } : undefined}
      >
        <RowToggle row={c} open={open} shared={shared} />
        <RowGrip row={c} gripHelp={gripHelp} onGrab={onGrab} onGripKeys={onGripKeys} />
        <RowTitle row={c} current={current} count={count} shared={shared} />
        {!c.translated && <Badge tone="warn">{t`Not translated yet`}</Badge>}
        <RowMenu
          row={c}
          index={i}
          last={last}
          chapters={shared.chapters}
          partIndexes={partIndexes}
          afterClose={afterClose}
          step={step}
          say={say}
          setEditing={shared.setEditing}
          setDeleting={shared.setDeleting}
          setHistory={shared.setHistory}
          setIcon={shared.setIcon}
        />
      </div>
      {c.kind === "part" && count === 0 && (
        <p className="m-0 px-2 pb-1.5 ps-9 text-xs text-ink-muted">{t`No chapters yet`}</p>
      )}
      {c.kind !== "part" && shared.underRow && shared.openRows?.has(c.id) && shared.underRow(c.id)}
    </li>
  );
}
