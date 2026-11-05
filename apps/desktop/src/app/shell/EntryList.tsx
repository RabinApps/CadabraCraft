import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import * as M from "@radix-ui/react-dropdown-menu";
import { useLingui } from "@lingui/react/macro";
import { plural } from "@lingui/core/macro";
import {
  ArrowDown,
  ArrowUp,
  Check,
  ChevronDown,
  ChevronRight,
  Ellipsis,
  GripVertical,
  History,
  Layers,
  Pencil,
  Shapes,
  Trash2,
} from "lucide-react";
import type { LanguageRow } from "@cadabracraft/format";
import { Badge } from "../../ui/Badge";
import { IconButton } from "../../ui/Button";
import { cx } from "../../ui/cx";
import { DropLine } from "../../ui/DropLine";
import { useDragReorder } from "../../ui/useDragReorder";
import { menuContentClass, menuItemClass, menuLabelClass } from "../../ui/Menu";
import { SectionHeading } from "../../ui/SectionHeading";
import { dropPosition, insertionIndex } from "../../lib/referenceKinds";
import { useProject } from "../../state/project/index";
import { attempt } from "../../state/attempt";
import type { HistoryPage } from "../dialogs/HistoryDialog";
import type { IconPage } from "../dialogs/IconDialog";
import { iconComponent } from "../../lib/chapterIcons";

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
  const moveFocus = (f: () => void) => () => void (afterClose.current = f);
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
                  <input
                    autoFocus
                    aria-label={titleLabel}
                    defaultValue={c.title}
                    className="min-w-0 flex-1 rounded-md border border-border-strong bg-surface px-2 py-1.5 text-sm text-ink focus-visible:outline-2 focus-visible:outline-accent"
                    onBlur={(e) => {
                      setEditing(null);
                      // Escape cancels: closing the field can still blur it, which must not save.
                      if (e.target.dataset.cancelled) return;
                      if (!e.target.value.trim())
                        useProject.setState({
                          notice: t`A title cannot be empty, so the old title was kept.`,
                        });
                      else if (e.target.value !== c.title)
                        attempt(actions.rename(c.id, e.target.value.trim()));
                    }}
                    onKeyDown={(e) => {
                      if (e.key !== "Enter" && e.key !== "Escape") return;
                      // The field goes away either way; the row's menu button takes the focus so it is not dropped on the page.
                      const menuButton = e.currentTarget
                        .closest("li")
                        ?.querySelector<HTMLElement>("[aria-haspopup=menu]");
                      if (e.key === "Enter") e.currentTarget.blur();
                      else {
                        e.currentTarget.dataset.cancelled = "true";
                        setEditing(null);
                      }
                      menuButton?.focus();
                    }}
                  />
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
                        if (next) {
                          e.preventDefault();
                          // The dialog that `next` opens remembers where focus is, to give it back when it closes.
                          const trigger = (e.target as HTMLElement).getAttribute("aria-labelledby");
                          document.getElementById(trigger ?? "")?.focus();
                        }
                        next?.();
                      }}
                      className={menuContentClass("min-w-44")}
                    >
                      {/* A blank page holds no text: there is no title to change, no text to give an icon to, no headings to list, and
                        no position or page start to choose (it is already the blank page, and it follows the page before it). */}
                      {c.kind !== "blank" && (
                        <>
                          <M.Item
                            className={menuItemClass()}
                            onSelect={moveFocus(() => setEditing({ id: c.id }))}
                          >
                            <Pencil size={14} aria-hidden />
                            {t`Rename`}
                          </M.Item>
                          <M.Item
                            className={menuItemClass()}
                            onSelect={moveFocus(() =>
                              setIcon({ id: c.id, title: c.title, icon: c.icon }),
                            )}
                          >
                            <Shapes size={14} aria-hidden />
                            {t`Change icon…`}
                          </M.Item>
                        </>
                      )}
                      {chapters && c.kind !== "part" && c.kind !== "blank" && (
                        <M.Item
                          className={menuItemClass()}
                          onSelect={() =>
                            attempt(actions.startPart(c.id, t`Part ${partIndexes.length + 1}`))
                          }
                        >
                          <Layers size={14} aria-hidden />
                          {t`Start part here`}
                        </M.Item>
                      )}
                      <M.Item
                        className={menuItemClass()}
                        disabled={c.kind === "part" ? partIndexes.indexOf(i) <= 0 : i === 0}
                        onSelect={() => step(i, -1)}
                      >
                        <ArrowUp size={14} aria-hidden />
                        {c.kind === "part" ? t`Move part up` : t`Move up`}
                      </M.Item>
                      <M.Item
                        className={menuItemClass()}
                        disabled={
                          c.kind === "part"
                            ? partIndexes.indexOf(i) === partIndexes.length - 1
                            : i === last
                        }
                        onSelect={() => step(i, 1)}
                      >
                        <ArrowDown size={14} aria-hidden />
                        {c.kind === "part" ? t`Move part down` : t`Move down`}
                      </M.Item>
                      {chapters && c.kind !== "part" && (
                        <>
                          <M.Separator className="my-1 h-px bg-border" />
                          <>
                            <M.Label className={menuLabelClass} aria-hidden>
                              {t`First letter`}
                            </M.Label>
                            <M.RadioGroup
                              aria-label={t`First letter`}
                              value={
                                c.dropCap === undefined ? "default" : c.dropCap ? "big" : "normal"
                              }
                              onValueChange={(v) => {
                                attempt(
                                  actions.setChapterDropCap(
                                    c.id,
                                    v === "default" ? null : v === "big",
                                  ),
                                );
                                const title = c.title;
                                setSaid(
                                  v === "default"
                                    ? t`${title}: first letter follows the book`
                                    : v === "big"
                                      ? t`${title}: big first letter`
                                      : t`${title}: normal first letter`,
                                );
                              }}
                            >
                              {(
                                [
                                  ["default", t`Default`],
                                  ["big", t`Big`],
                                  ["normal", t`Normal`],
                                ] as const
                              ).map(([value, text]) => (
                                <M.RadioItem key={value} value={value} className={menuItemClass()}>
                                  <span className="flex size-3.5 items-center justify-center text-accent">
                                    <M.ItemIndicator>
                                      <Check size={14} aria-hidden />
                                    </M.ItemIndicator>
                                  </span>
                                  {text}
                                </M.RadioItem>
                              ))}
                            </M.RadioGroup>
                          </>
                          <M.Separator className="my-1 h-px bg-border" />
                        </>
                      )}
                      {!chapters &&
                        c.kind !== "contents" &&
                        c.kind !== "copyright" &&
                        c.kind !== "blank" && (
                          <>
                            <M.Separator className="my-1 h-px bg-border" />
                            <M.Label className={menuLabelClass} aria-hidden>
                              {t`Vertical position`}
                            </M.Label>
                            <M.RadioGroup
                              aria-label={t`Vertical position`}
                              value={
                                c.verticalCenter === undefined
                                  ? "default"
                                  : c.verticalCenter
                                    ? "centred"
                                    : "top"
                              }
                              onValueChange={(v) => {
                                attempt(
                                  actions.setVerticalCenter(
                                    c.id,
                                    v === "default" ? null : v === "centred",
                                  ),
                                );
                                const title = c.title;
                                setSaid(
                                  v === "default"
                                    ? t`${title}: vertical position follows the template`
                                    : v === "centred"
                                      ? t`${title}: centred on the page`
                                      : t`${title}: at the top of the page`,
                                );
                              }}
                            >
                              {(
                                [
                                  ["default", t`Default`],
                                  ["centred", t`Centred`],
                                  ["top", t`Top`],
                                ] as const
                              ).map(([value, text]) => (
                                <M.RadioItem key={value} value={value} className={menuItemClass()}>
                                  <span className="flex size-3.5 items-center justify-center text-accent">
                                    <M.ItemIndicator>
                                      <Check size={14} aria-hidden />
                                    </M.ItemIndicator>
                                  </span>
                                  {text}
                                </M.RadioItem>
                              ))}
                            </M.RadioGroup>
                          </>
                        )}
                      {/* Where the page numbering puts a matter page: the book's rules (a dedication, epigraph or title page opens on a
                        right-hand page, with a blank left-hand page before it when that is what it takes), the next page whatever the
                        rules say (no blank page before it), or a right-hand page (a blank page inserted when the rules leave it on a
                        verso). All three are always offered: a page can be taken off a blank it no longer wants, or given one. */}
                      {!chapters && c.kind !== "blank" && (
                        <>
                          <M.Separator className="my-1 h-px bg-border" />
                          <M.Label className={menuLabelClass} aria-hidden>
                            {t`Page start`}
                          </M.Label>
                          <M.RadioGroup
                            aria-label={t`Page start`}
                            value={
                              c.startOnNext === undefined
                                ? "book"
                                : c.startOnNext
                                  ? "next"
                                  : "recto"
                            }
                            onValueChange={(v) => {
                              attempt(
                                actions.setStartOnNext(c.id, v === "book" ? null : v === "next"),
                              );
                              setSaid(
                                v === "book"
                                  ? t`${c.title}: page start follows the book`
                                  : v === "next"
                                    ? t`${c.title}: starts on the next page`
                                    : t`${c.title}: starts on a right-hand page`,
                              );
                            }}
                          >
                            {(
                              [
                                ["book", t`Follows the book`],
                                ["next", t`Start on the next page`],
                                ["recto", t`Start on a right-hand page`],
                              ] as const
                            ).map(([value, text]) => (
                              <M.RadioItem key={value} value={value} className={menuItemClass()}>
                                <span className="flex size-3.5 items-center justify-center text-accent">
                                  <M.ItemIndicator>
                                    <Check size={14} aria-hidden />
                                  </M.ItemIndicator>
                                </span>
                                {text}
                              </M.RadioItem>
                            ))}
                          </M.RadioGroup>
                          <M.Separator className="my-1 h-px bg-border" />
                        </>
                      )}
                      {c.kind !== "blank" && (
                        <M.Item
                          className={menuItemClass()}
                          onSelect={moveFocus(() =>
                            setHistory({ id: c.id, title: c.title, file: c.file }),
                          )}
                        >
                          <History size={14} aria-hidden />
                          {t`History`}
                        </M.Item>
                      )}
                      <M.Item
                        className={menuItemClass("text-danger")}
                        onSelect={moveFocus(() => setDeleting({ id: c.id, title: c.title }))}
                      >
                        <Trash2 size={14} aria-hidden />
                        {c.kind === "part" ? t`Remove part` : t`Move to trash`}
                      </M.Item>
                    </M.Content>
                  </M.Portal>
                </M.Root>
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
