import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { useLingui } from "@lingui/react/macro";
import { ChevronDown, ChevronRight } from "lucide-react";
import type { LanguageRow } from "@cadabracraft/format";
import { useDragReorder } from "../../ui/useDragReorder";
import { SectionHeading } from "../../ui/SectionHeading";
import { dropPosition, insertionIndex } from "../../lib/references/referenceKinds";
import { useProject } from "../../state/project/index";
import { attempt } from "../../state/attempt";
import type { HistoryPage } from "../dialogs/HistoryDialog";
import type { IconPage } from "../dialogs/IconDialog";
import { EntryRow } from "./entries/EntryRow";

export type Editing = { id: string } | null;

export interface ListProps {
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

/** Moving a page one place by key or menu: says where it went, or that it cannot go further. */
function useEntryMoves(entries: LanguageRow[], partIndexes: number[]) {
  const { t } = useLingui();
  const actions = useProject((s) => s.actions);
  const last = entries.length - 1;
  /** A moved page is announced (the grip keeps focus and its name does not change, so nothing else would say it moved). */
  const [said, setSaid] = useState("");
  const gripHelp = useId();
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
  return { said, setSaid, step, gripKeys, gripHelp };
}

/**
 * A part divider is a row of the chapters list: the entries after it belong to it until the next divider. Parts are not dragged
 * (that would move the divider alone and regroup its chapters): their menu moves the whole group with `actions.movePart`.
 * A collapsed part hides every row after it until the next divider, without changing the manifest order.
 */
function partLayout(entries: LanguageRow[], collapsedParts: Set<string> | undefined) {
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
  const hidden = new Set<string>();
  let hiddenPart = false;
  entries.forEach((e) => {
    if (e.kind === "part") hiddenPart = collapsedParts?.has(e.id) ?? false;
    else if (hiddenPart) hidden.add(e.id);
  });
  return { partIndexes, counts, depth, hidden };
}

/** Dragging a page to a new place in its list. */
function useEntryDrag(entries: LanguageRow[]) {
  const actions = useProject((s) => s.actions);
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
  return { list, drag, grab };
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
  const [headingOpen, setHeadingOpen] = useState(true);
  const { partIndexes, counts, depth, hidden } = partLayout(entries, collapsedParts);
  /** Rename, History and Trash run once the menu has closed, so the field or dialog they open can take focus; after any other item focus returns to the menu button. */
  const afterClose = useRef<(() => void) | null>(null);
  const { list, drag, grab } = useEntryDrag(entries);
  const shared = {
    chapters,
    titleLabel,
    editing,
    setEditing,
    setDeleting,
    setHistory,
    setIcon,
    onNavigate,
    underRow,
    onToggleRow,
    onTogglePart,
    openRows,
  };
  const { said, setSaid, step, gripKeys, gripHelp } = useEntryMoves(entries, partIndexes);
  const listId = useId();
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
        {entries.map((c, i) =>
          hidden.has(c.id) ? null : (
            <EntryRow
              key={c.id}
              row={c}
              index={i}
              total={entries.length}
              current={c.id === currentId}
              open={
                c.kind === "part"
                  ? !(collapsedParts?.has(c.id) ?? false)
                  : (openRows?.has(c.id) ?? false)
              }
              indented={depth[i] === 1}
              count={counts.get(c.id)}
              drag={drag}
              partIndexes={partIndexes}
              afterClose={afterClose}
              gripHelp={gripHelp}
              onGrab={grab(c.id, i)}
              onGripKeys={gripKeys(i)}
              step={step}
              say={setSaid}
              shared={shared}
            />
          ),
        )}
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
