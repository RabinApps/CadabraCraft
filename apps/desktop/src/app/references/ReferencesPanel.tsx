import { Fragment, useEffect, useMemo, useRef, useState, type PointerEvent } from "react";
import { useLingui } from "@lingui/react/macro";
import { plural } from "@lingui/core/macro";
import * as M from "@radix-ui/react-dropdown-menu";
import {
  ArchiveRestore,
  ArrowUpDown,
  Check,
  ChevronDown,
  Grid2x2,
  List,
  Plus,
  Upload,
  X,
} from "lucide-react";
import {
  allTags,
  canReorder,
  dropPosition,
  filterReferences,
  insertionIndex,
  NO_FILTER,
  sortReferences,
  type ReferenceKind,
  type SortKey,
} from "../../lib/references/referenceKinds";
import { attempt } from "../../state/attempt";
import { useProject } from "../../state/project/index";
import { Button, IconButton } from "../../ui/Button";
import { Chip } from "../../ui/feedback/Chip";
import { Field } from "../../ui/forms/Input";
import { Notice } from "../../ui/feedback/Notice";
import { cx } from "../../ui/cx";
import { ProgressBar } from "../../ui/feedback/ProgressBar";
import { menuContentClass, menuItemClass } from "../../ui/Menu";
import { ReferenceRow } from "./ReferenceRow";
import { RemovedReferencesDialog } from "./RemovedReferencesDialog";
import { useReferenceDrop } from "./useReferenceDrop";

interface Props {
  /** The reference shown in the viewer, if any. */
  openId?: string | null;
  onOpen: (id: string) => void;
  /** Given when the panel is a drawer: shows a close button next to Add files. */
  onClose?: () => void;
}

/** The line that shows where a dragged row will land, drawn in the gap above (or below) a row so the list does not move. */
function DropLine({ below }: { below?: boolean }) {
  return (
    <span
      aria-hidden
      data-drop-line
      className={cx(
        "pointer-events-none absolute inset-x-0 h-0.75 rounded-full bg-accent",
        below ? "bottom-[-5.5px]" : "top-[-5.5px]",
      )}
    >
      <span className="absolute -inset-s-1 -top-0.75 size-2.25 rounded-full bg-accent" />
    </span>
  );
}

/** The author's reference library: search, filter by kind and tag, add files, and open one in the viewer. */
export function ReferencesPanel({ openId, onOpen, onClose }: Props) {
  const { t } = useLingui();
  const references = useProject((s) => s.manifest!.references);
  const notices = useProject((s) => s.referenceNotices);
  const importing = useProject((s) => s.referenceImport);
  const actions = useProject((s) => s.actions);
  const [filter, setFilter] = useState(NO_FILTER);
  const [grid, setGrid] = useState(false);
  useReferenceDrop();
  const [sort, setSort] = useState<SortKey>("manual");
  const [removedOpen, setRemovedOpen] = useState(false);
  const removedCount = useProject((s) => s.removedReferences.length);
  useEffect(() => {
    void actions.refreshRemovedReferences();
  }, [actions]);
  const manual = sort === "manual";
  const reorderable = canReorder(filter) && !grid && manual;
  /** The row being dragged and the insertion point (0 = before the first row) under the pointer. */
  const [drag, setDrag] = useState<{ id: string; at: number } | null>(null);
  const at = useRef(0);
  const list = useRef<HTMLUListElement>(null);
  const dragId = drag?.id;
  useEffect(() => {
    if (!dragId) return;
    const move = (e: globalThis.PointerEvent) => {
      const rows = [...list.current!.children].map((li) => li.getBoundingClientRect());
      at.current = insertionIndex(
        rows.map((r) => r.top + r.height / 2),
        e.clientY,
      );
      setDrag({ id: dragId, at: at.current });
    };
    const drop = () => {
      const from = references.findIndex((r) => r.id === dragId);
      setDrag(null);
      const to = dropPosition(from, at.current);
      if (to !== from) attempt(actions.moveReference(dragId, to));
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", drop);
    window.addEventListener("pointercancel", drop);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", drop);
      window.removeEventListener("pointercancel", drop);
    };
  }, [dragId, references, actions]);
  /** After a keyboard move the grip keeps focus, even if React moved its row in the DOM. */
  const refocus = useRef<string | null>(null);
  useEffect(() => {
    const id = refocus.current;
    if (!id) return;
    refocus.current = null;
    list.current
      ?.querySelector<HTMLElement>(`[data-ref-id="${CSS.escape(id)}"] [data-grip]`)
      ?.focus();
  }, [references]);
  const grab = (id: string, index: number) => (e: PointerEvent<HTMLElement>) => {
    e.preventDefault();
    at.current = index;
    setDrag({ id, at: index });
  };
  const tags = useMemo(() => allTags(references), [references]);
  const shown = useMemo(
    () => sortReferences(filterReferences(references, filter), sort),
    [references, filter, sort],
  );
  const sorts: [SortKey, string][] = [
    ["manual", t`Manual order`],
    ["title-asc", t`Title A-Z`],
    ["title-desc", t`Title Z-A`],
    ["newest", t`Newest first`],
    ["oldest", t`Oldest first`],
    ["kind", t`Kind`],
  ];
  const kinds: [ReferenceKind | "all", string][] = [
    ["all", t`All`],
    ["image", t`Images`],
    ["video", t`Video`],
    ["pdf", t`PDF`],
    ["audio", t`Audio`],
    ["text", t`Documents`],
    ["other", t`Other`],
  ];
  const add = () => attempt(actions.addReferences());
  return (
    <section aria-label={t`References`} className="flex h-full min-h-0 flex-col gap-3 p-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-lead font-semibold">{t`References`}</h2>
        <div className="flex items-center gap-1">
          <Button variant="primary" size="sm" icon={Plus} onClick={add}>{t`Add files`}</Button>
          {onClose && <IconButton icon={X} label={t`Close references`} onClick={onClose} />}
        </div>
      </div>
      <div className="flex items-end gap-2">
        <div className="min-w-0 flex-1">
          <Field
            label={t`Search references`}
            hideLabel
            placeholder={t`Search references`}
            type="search"
            value={filter.query}
            onChange={(e) => setFilter({ ...filter, query: e.target.value })}
          />
        </div>
        <IconButton
          icon={grid ? List : Grid2x2}
          label={grid ? t`Show as list` : t`Show as grid`}
          onClick={() => setGrid(!grid)}
        />
      </div>
      <div className="flex items-center justify-between gap-2">
        <M.Root>
          <M.Trigger asChild>
            <button
              type="button"
              className="flex h-8 items-center gap-1.5 rounded-md border border-border-strong px-2.5 text-xs font-semibold text-ink data-[state=open]:border-accent data-[state=open]:bg-accent-soft data-[state=open]:text-accent focus-visible:outline-2 focus-visible:outline-accent"
            >
              <ArrowUpDown size={14} aria-hidden />
              <span className="sr-only">{t`Sort references`} </span>
              {sorts.find(([k]) => k === sort)![1]}
              <ChevronDown size={14} aria-hidden />
            </button>
          </M.Trigger>
          <M.Portal>
            <M.Content align="start" className={menuContentClass("min-w-52")}>
              <M.RadioGroup value={sort} onValueChange={(v) => setSort(v as SortKey)}>
                {sorts.map(([key, text]) => (
                  <Fragment key={key}>
                    {key === "title-asc" && <M.Separator className="my-1 h-px bg-border" />}
                    <M.RadioItem value={key} className={menuItemClass()}>
                      <span className="flex size-3.5 items-center justify-center text-accent">
                        <M.ItemIndicator>
                          <Check size={14} aria-hidden />
                        </M.ItemIndicator>
                      </span>
                      <span className={key === sort ? "font-semibold" : ""}>{text}</span>
                    </M.RadioItem>
                  </Fragment>
                ))}
              </M.RadioGroup>
            </M.Content>
          </M.Portal>
        </M.Root>
        <span className="text-xs text-ink-muted">
          {plural(shown.length, { one: "# reference", other: "# references" })}
        </span>
      </div>
      {!grid && references.length > 1 && !reorderable && (
        <p className="flex items-center gap-1.5 text-xs text-ink-muted">
          <ArrowUpDown size={14} aria-hidden />
          {manual ? t`Clear search and filters to reorder` : t`Switch to Manual order to reorder`}
        </p>
      )}
      <div role="group" aria-label={t`Filter by type`} className="flex flex-wrap gap-1.5">
        {kinds.map(([kind, label]) => (
          <Chip
            key={kind}
            pressed={filter.kind === kind}
            onClick={() => setFilter({ ...filter, kind })}
          >
            {label}
          </Chip>
        ))}
      </div>
      {tags.length > 0 && (
        <div role="group" aria-label={t`Filter by tag`} className="flex flex-wrap gap-1.5">
          {tags.map((tag) => (
            <Chip
              key={tag}
              pressed={filter.tag === tag}
              onClick={() => setFilter({ ...filter, tag: filter.tag === tag ? null : tag })}
            >
              {`#${tag}`}
            </Chip>
          ))}
        </div>
      )}
      {importing && (
        <div
          className="flex flex-col gap-2 rounded-md border border-border bg-surface p-3"
          role="status"
        >
          <div className="flex justify-between gap-2 text-sm font-semibold">
            <span className="min-w-0 truncate">{importing.name}</span>
            <span className="text-xs text-ink-muted">{`${importing.index} / ${importing.total}`}</span>
          </div>
          <ProgressBar
            label={t`Adding ${importing.name}`}
            value={importing.index - 1}
            max={importing.total}
            className="h-2 bg-border"
          />
        </div>
      )}
      {notices.length > 0 && (
        <div className="flex flex-col gap-2">
          {notices.map((n, i) => (
            <Notice key={i} tone={n.tone} role={n.tone === "danger" ? "alert" : "status"}>
              {n.text}
            </Notice>
          ))}
          <Button size="sm" icon={X} onClick={actions.dismissReferenceNotices}>{t`Dismiss`}</Button>
        </div>
      )}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {references.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 px-2 text-center">
            <span className="flex size-14 items-center justify-center rounded-full bg-accent-soft text-accent">
              <Upload size={26} aria-hidden />
            </span>
            <h3 className="text-lead font-semibold">{t`Keep your research close`}</h3>
            <p className="max-w-60 text-sm text-ink-muted">
              {t`Add images, videos, PDFs, audio and notes you want to look at while you write. They stay in the book folder.`}
            </p>
          </div>
        ) : shown.length === 0 ? (
          <p className="py-6 text-center text-sm text-ink-muted">{t`No references match.`}</p>
        ) : (
          <ul ref={list} className={grid ? "grid grid-cols-2 gap-2" : "flex flex-col gap-2"}>
            {shown.map((r, i) => (
              <li key={r.id} data-ref-id={r.id} className="relative min-w-0">
                {drag && drag.at === i && <DropLine />}
                {drag && drag.at === shown.length && i === shown.length - 1 && <DropLine below />}
                <div>
                  <ReferenceRow
                    reference={r}
                    selected={r.id === openId}
                    onOpen={() => onOpen(r.id)}
                    onRemove={() => attempt(actions.removeReference(r.id))}
                    {...(reorderable
                      ? {
                          reorder: {
                            onGrab: grab(r.id, i),
                            onMove: (d: number) => {
                              refocus.current = r.id;
                              attempt(actions.moveReference(r.id, i + d));
                            },
                            first: i === 0,
                            last: i === shown.length - 1,
                            dragging: drag?.id === r.id,
                          },
                        }
                      : {})}
                  />
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
      <button
        type="button"
        onClick={add}
        className="flex flex-col items-center gap-1.5 rounded-md border border-dashed border-border-strong p-4 text-sm text-ink-muted hover:bg-accent-soft/60 focus-visible:outline-2 focus-visible:outline-accent"
      >
        <Upload size={18} aria-hidden />
        {t`Drop files here to add them`}
      </button>
      {removedCount > 0 && (
        <Button variant="ghost" icon={ArchiveRestore} onClick={() => setRemovedOpen(true)}>
          {t`Removed references (${removedCount})`}
        </Button>
      )}
      <RemovedReferencesDialog open={removedOpen} onOpenChange={setRemovedOpen} />
    </section>
  );
}
