import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { useLingui } from "@lingui/react/macro";
import { plural } from "@lingui/core/macro";
import { ChevronDown, ChevronRight, GripVertical, Layers } from "lucide-react";
import type { LanguageRow } from "@cadabracraft/format";
import { Badge } from "../../ui/feedback/Badge";
import { cx } from "../../ui/cx";
import { DropLine } from "../../ui/DropLine";
import { useDragReorder } from "../../ui/useDragReorder";
import { SectionHeading } from "../../ui/SectionHeading";
import { dropPosition, insertionIndex } from "../../lib/references/referenceKinds";
import { useProject } from "../../state/project/index";
import { attempt } from "../../state/attempt";
import type { HistoryPage } from "../dialogs/HistoryDialog";
import type { IconPage } from "../dialogs/IconDialog";
import { iconComponent } from "../../lib/chapterIcons";
import { RenameField } from "./entries/RenameField";
import { RowMenu } from "./entries/RowMenu";

export type Editing = { id: string } | null;

interface ListProps {
  entries: LanguageRow[];
  heading: string;
  titleLabel: string;
  /** Chapters get a First letter choice in the row menu; front and back matter never have a big first letter. */
  chapters?: boolean;
  currentId: string | null;
  editing: Editing;
  setEditing: (e: Editing) => void;
  setDeleting: (d: { id: string; title: string }) => void;
  setHistory: (p: HistoryPage) => void;
  setIcon: (p: IconPage) => void;
  onNavigate?: () => void;
  /** What sits indented under a row (a chapter's scenes); it shows for the rows in `openRows`. */
  underRow?: (id: string) => ReactNode;
  /** The rows that are showing what sits under them (chapters start closed unless they are the open page). */
  openRows?: Set<string>;
  /** Present on chapters: the chevron that opens and closes a row's scenes. */
  onToggleRow?: (id: string) => void;
  /** Parts whose chapters are hidden; parts otherwise start open. */
  collapsedParts?: Set<string>;
  /** Present on chapters: the chevron that hides and shows a part's chapters. */
  onTogglePart?: (id: string) => void;
  /** Present on front and back matter: the section heading opens and closes the whole list. */
  collapsible?: boolean;
}

/** One section of the book (front matter, chapters or back matter): the same row, rename, reorder and trash actions in each. */
export function EntryList({
  entries,
  heading,
  titleLabel,
  chapters,
  currentId,
  editing,
  setEditing,
  setDeleting,
  setHistory,
  setIcon,
  onNavigate,
  underRow,
  openRows,
  onToggleRow,
  collapsedParts,
  onTogglePart,
  collapsible,
}: ListProps) {
  const { t } = useLingui();
  const actions = useProject((s) => s.actions);
  const [headingOpen, setHeadingOpen] = useState(true);
  const last = entries.length - 1;
  // A part divider is a row of the chapters list: the entries after it belong to it until the next divider. Parts are not dragged
  // (that would move the divider alone and regroup its chapters): their menu moves the whole group with `actions.movePart`.
  const partIndexes = entries.flatMap((e, i) => (e.kind === "part" ? [i] : []));
  const counts = new Map<string, number>();
  let group: string | undefined;
  entries.forEach((e) => {
    if (e.kind === "part") {
      group = e.id;
      counts.set(e.id, 0);
    } else if (group !== undefined && e.kind !== "blank") {
      counts.set(group, (counts.get(group) ?? 0) + 1);
    }
  });
  let grouped = false;
  const depth = entries.map((e) => {
    if (e.kind === "part") {
      grouped = true;
      return 0;
    }
    return grouped ? 1 : 0;
  });
  // A collapsed part hides every row after it until the next divider, without changing the manifest order.
  const hidden = new Set<string>();
  let hiddenPart = false;
  entries.forEach((e) => {
    if (e.kind === "part") hiddenPart = collapsedParts?.has(e.id) ?? false;
    else if (hiddenPart) hidden.add(e.id);
  });
  /** Rename, History and Trash run once the menu has closed, so the field or dialog they open can take focus; after any other item focus returns to the menu button. */
  const afterClose = useRef<(() => void) | null>(null);
  const list = useRef<HTMLUListElement>(null);
  const { drag, grab } = useDragReorder<number>({
    locate: (_x, y) =>
      insertionIndex(
        [...list.current!.children].map((li) => {
          const r = li.getBoundingClientRect();
          return r.top + r.height / 2;
        }),
        y,
      ),
    onDrop: (id, at) => {
      const from = entries.findIndex((c) => c.id === id);
      const to = dropPosition(from, at);
      if (to !== from) attempt(actions.move(id, to - from));
    },
  });
  /** A moved page is announced (the grip keeps focus and its name does not change, so nothing else would say it moved). */
  const [said, setSaid] = useState("");
  const gripHelp = useId();
  const listId = useId();
  useEffect(() => {
    if (!said) return;
    const timer = setTimeout(() => setSaid(""), 4000);
    return () => clearTimeout(timer);
  }, [said]);
  /** Moves a page one place and says where it went, or that it cannot go further. */
  const step = (i: number, delta: -1 | 1) => {
    const title = entries[i]!.title;
    if (entries[i]!.kind === "part") {
      const pi = partIndexes.indexOf(i);
      if (pi + delta < 0) return setSaid(t`${title} is already the first part`);
      if (pi + delta > partIndexes.length - 1) return setSaid(t`${title} is already the last part`);
      attempt(actions.movePart(entries[i]!.id, delta));
      const partNo = delta < 0 ? pi : pi + 2;
      setSaid(
        delta < 0
          ? t`Moved ${title} up to part ${partNo} of ${partIndexes.length}`
          : t`Moved ${title} down to part ${partNo} of ${partIndexes.length}`,
      );
      return;
    }
    if (i + delta < 0) return setSaid(t`${title} is already first`);
    if (i + delta > last) return setSaid(t`${title} is already last`);
    attempt(actions.move(entries[i]!.id, delta));
    const place = i + delta + 1;
    setSaid(
      delta < 0
        ? t`Moved ${title} up to position ${place} of ${entries.length}`
        : t`Moved ${title} down to position ${place} of ${entries.length}`,
    );
  };
  // The grip is the keyboard alternative to dragging (WCAG 2.5.7): the arrow keys move the page one place.
  const gripKeys = (i: number) => (e: KeyboardEvent) => {
    if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
    e.preventDefault();
    step(i, e.key === "ArrowUp" ? -1 : 1);
  };
  return (
    <section aria-label={heading} className="flex flex-col gap-0.5">
      {collapsible ? (
        <div className="flex items-center gap-1 ps-1">
          <button
            type="button"
            aria-expanded={headingOpen}
            aria-controls={listId}
            aria-label={headingOpen ? t`Collapse ${heading}` : t`Expand ${heading}`}
            onClick={() => setHeadingOpen((open) => !open)}
            className="flex size-5 shrink-0 items-center justify-center rounded-sm text-ink-muted hover:bg-raised focus-visible:outline-2 focus-visible:outline-accent max-md:size-11"
          >
            {headingOpen ? (
              <ChevronDown size={14} aria-hidden />
            ) : (
              <ChevronRight size={14} aria-hidden />
            )}
          </button>
          <SectionHeading className="py-1">{heading}</SectionHeading>
        </div>
      ) : (
        <SectionHeading className="px-2.5 pt-1">{heading}</SectionHeading>
      )}
      <ul
        id={listId}
        ref={list}
        className="m-0 flex list-none flex-col gap-0.5 p-0"
        style={collapsible && !headingOpen ? { display: "none" } : undefined}
      >
        {entries.map((c, i) => {
          if (hidden.has(c.id)) return null;
          const current = c.id === currentId;
          const Icon = iconComponent(c.icon);
          const open =
            c.kind === "part"
              ? !(collapsedParts?.has(c.id) ?? false)
              : (openRows?.has(c.id) ?? false);
          return (
            <li
              key={c.id}
              className={cx(
                "group relative flex flex-col rounded-md",
                current && "bg-accent-soft",
                drag?.id === c.id && "opacity-40",
                c.kind === "part" && "mt-2 border-t border-border pt-1",
              )}
            >
              {drag && drag.at === i && <DropLine />}
              {drag && drag.at === entries.length && i === last && <DropLine below />}{" "}
              <div
                className="flex items-center gap-1 ps-1"
                style={depth[i] ? { paddingInlineStart: "1.25rem" } : undefined}
              >
                {((c.kind === "part" && onTogglePart) || (c.kind !== "part" && onToggleRow)) && (
                  <button
                    type="button"
                    aria-expanded={open}
                    aria-label={
                      c.kind === "part"
                        ? open
                          ? t`Hide chapters of ${c.title}`
                          : t`Show chapters of ${c.title}`
                        : open
                          ? t`Hide scenes of ${c.title}`
                          : t`Show scenes of ${c.title}`
                    }
                    onClick={() => (c.kind === "part" ? onTogglePart?.(c.id) : onToggleRow?.(c.id))}
                    className="flex size-5 shrink-0 items-center justify-center rounded-sm text-ink-muted hover:bg-raised focus-visible:outline-2 focus-visible:outline-accent max-md:size-11"
                  >
                    {open ? (
                      <ChevronDown size={14} aria-hidden />
                    ) : (
                      <ChevronRight size={14} aria-hidden />
                    )}
                  </button>
                )}
                {c.kind === "part" ? (
                  <span
                    aria-hidden
                    className="flex size-6 shrink-0 items-center justify-center text-ink-muted"
                  >
                    <Layers size={15} />
                  </span>
                ) : (
                  <button
                    type="button"
                    data-grip
                    aria-label={t`Reorder ${c.title}`}
                    aria-keyshortcuts="ArrowUp ArrowDown"
                    aria-describedby={gripHelp}
                    onPointerDown={grab(c.id, i)}
                    onKeyDown={gripKeys(i)}
                    className="flex size-6 shrink-0 cursor-grab touch-none items-center justify-center rounded-sm text-ink-muted max-md:size-11 focus-visible:outline-2 focus-visible:outline-accent"
                  >
                    <GripVertical size={16} aria-hidden />
                  </button>
                )}
                {editing?.id === c.id ? (
                  <RenameField row={c} titleLabel={titleLabel} setEditing={setEditing} />
                ) : (
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
                    {Icon && (
                      <Icon size={14} aria-hidden className="me-2 inline shrink-0 align-[-2px]" />
                    )}
                    {c.title}
                    {c.kind === "part" && (counts.get(c.id) ?? 0) > 0 && (
                      <span className="ms-2 text-xs font-normal text-ink-muted">
                        {plural(counts.get(c.id) ?? 0, {
                          one: "# chapter",
                          other: "# chapters",
                        })}
                      </span>
                    )}
                  </button>
                )}
                {!c.translated && <Badge tone="warn">{t`Not translated yet`}</Badge>}
                <RowMenu
                  row={c}
                  index={i}
                  last={last}
                  chapters={chapters}
                  partIndexes={partIndexes}
                  afterClose={afterClose}
                  step={step}
                  say={setSaid}
                  setEditing={setEditing}
                  setDeleting={setDeleting}
                  setHistory={setHistory}
                  setIcon={setIcon}
                />
              </div>
              {c.kind === "part" && counts.get(c.id) === 0 && (
                <p className="m-0 px-2 pb-1.5 ps-9 text-xs text-ink-muted">{t`No chapters yet`}</p>
              )}
              {c.kind !== "part" && underRow && openRows?.has(c.id) && underRow(c.id)}
            </li>
          );
        })}
      </ul>
      <p id={gripHelp} className="sr-only">
        {t`Drag to move, or press the up and down arrow keys. Escape cancels a drag.`}
      </p>
      <p aria-live="polite" className="sr-only">
        {said}
      </p>
    </section>
  );
}

/** Pages moved to the project trash, each with a Restore button. */
