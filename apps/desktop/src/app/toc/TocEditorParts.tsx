import { useEffect, useRef, useState, type PointerEvent, type RefObject } from "react";
import { useLingui } from "@lingui/react/macro";
import { Plus, RotateCcw, X } from "lucide-react";
import type { EditionEntry, TocDepth, TocItem, TocSettings } from "@cadabracraft/format";
import { attempt } from "../../state/attempt";
import { useProject } from "../../state/project/index";
import {
  dropPosition,
  insertionIndex,
  staleKeys,
  staleLabel,
  type TocRow as Row,
} from "../../lib/toc/tocView";
import type { TocPane } from "../../state/view/tocPane";
import { Button } from "../../ui/Button";
import { DropLine } from "../../ui/DropLine";
import { Segmented } from "../../ui/forms/Segmented";
import { Switch } from "../../ui/forms/Switch";
import { TocRow } from "./TocRow";

/** The entry being dragged and the insertion point under the pointer; dropping saves the new order. */
export function useTocDrag(items: TocItem[], id: string) {
  const actions = useProject((s) => s.actions);
  const [drag, setDrag] = useState<{ key: string; at: number } | null>(null);
  const at = useRef(0);
  const list = useRef<HTMLUListElement>(null);
  const dragKey = drag?.key;
  useEffect(() => {
    if (!dragKey) return;
    const move = (e: globalThis.PointerEvent) => {
      const boxes = [...list.current!.children].map((li) => li.getBoundingClientRect());
      at.current = insertionIndex(
        boxes.map((r) => r.top + r.height / 2),
        e.clientY,
      );
      setDrag({ key: dragKey, at: at.current });
    };
    const drop = () => {
      const from = items.findIndex((i) => i.key === dragKey);
      setDrag(null);
      const to = dropPosition(from, at.current);
      if (to !== from) attempt(actions.moveTocItem(id, items, dragKey, to));
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", drop);
    window.addEventListener("pointercancel", drop);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", drop);
      window.removeEventListener("pointercancel", drop);
    };
  }, [dragKey, items, id, actions]);
  const grab = (key: string, index: number) => (e: PointerEvent<HTMLElement>) => {
    e.preventDefault();
    at.current = index;
    setDrag({ key, at: index });
  };
  return { drag, list, grab };
}

export function SettingsBar({ id, settings }: { id: string; settings: TocSettings }) {
  const { t } = useLingui();
  const actions = useProject((s) => s.actions);
  const depths: { value: `${TocDepth}`; label: string }[] = [
    { value: "0", label: t`Chapters` },
    { value: "1", label: t`+H1` },
    { value: "2", label: t`+H1-H2` },
    { value: "3", label: t`+H1-H3` },
  ];
  return (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
      <div className="flex flex-col gap-1.5">
        <span className="text-xs font-semibold text-ink-muted">{t`List`}</span>
        <Segmented
          label={t`Headings to list`}
          value={`${settings.depth}`}
          items={depths}
          onChange={(v) => attempt(actions.setTocDepth(id, Number(v) as TocDepth))}
        />
      </div>
      <div className="flex items-center gap-2.5">
        <Switch
          label={t`Page numbers`}
          checked={settings.pageNumbers}
          onChange={(on) => attempt(actions.setTocPageNumbers(id, on))}
        />
        <span aria-hidden className="text-sm text-ink">
          {t`Page numbers`}
        </span>
      </div>
      <div className="flex items-center gap-2.5">
        <Switch
          label={t`Include parts`}
          checked={settings.parts}
          onChange={(on) => attempt(actions.setTocParts(id, on))}
        />
        <span aria-hidden className="text-sm text-ink">
          {t`Include parts`}
        </span>
      </div>
    </div>
  );
}

export function StaleChanges({
  entry,
  language,
  keys,
  onRemove,
}: {
  entry: EditionEntry;
  language: string;
  keys: string[];
  onRemove: (key: string) => void;
}) {
  const { t } = useLingui();
  if (keys.length === 0) return null;
  return (
    <section aria-label={t`Changes that no longer match`} className="flex flex-col gap-2">
      <h3 className="text-sm font-semibold">{t`Changes that no longer match`}</h3>
      <p className="text-xs text-ink-muted">
        {t`These changes belong to a chapter or heading that is gone or was edited. They are kept until you remove them.`}
      </p>
      <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
        {keys.map((key) => {
          const label = staleLabel(entry, key, language);
          return (
            <li
              key={key}
              data-stale-key={key}
              className="flex items-center gap-2 rounded-md border border-border bg-surface p-1.5 ps-3"
            >
              <span className="min-w-0 flex-1 truncate text-sm">{label}</span>
              <Button
                size="sm"
                icon={X}
                aria-label={t`Remove change for ${label}`}
                onClick={() => onRemove(key)}
              >
                {t`Remove`}
              </Button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

export function EntryRows({
  id,
  items,
  rows,
  numbers,
  list,
  drag,
  editing,
  setEditing,
  onGrab,
  onMove,
  onRemove,
}: {
  id: string;
  items: TocItem[];
  rows: Row[];
  numbers: boolean;
  list: RefObject<HTMLUListElement | null>;
  drag: { key: string; at: number } | null;
  editing: string | null;
  setEditing: (key: string | null) => void;
  onGrab: (key: string, index: number) => (e: PointerEvent<HTMLElement>) => void;
  onMove: (index: number, delta: number) => void;
  onRemove: (key: string, to: string | null) => void;
}) {
  const { t } = useLingui();
  const actions = useProject((s) => s.actions);
  if (items.length === 0)
    return (
      <p className="rounded-md border border-dashed border-border-strong p-6 text-center text-sm text-ink-muted">
        {t`Nothing to list yet. Add a chapter and it appears here.`}
      </p>
    );
  return (
    <ul
      ref={list}
      aria-label={t`Contents entries`}
      className="m-0 flex list-none flex-col gap-1.5 p-0"
    >
      {rows.map((row, i) => (
        <li key={row.item.key} className="relative min-w-0">
          {drag && drag.at === i && <DropLine />}
          {drag && drag.at === rows.length && i === rows.length - 1 && <DropLine below />}
          <TocRow
            row={row}
            numbers={numbers}
            editing={editing === row.item.key}
            setEditing={(on) => setEditing(on ? row.item.key : null)}
            onGrab={onGrab(row.item.key, i)}
            onMove={(d) => onMove(i, d)}
            onRename={(title) => attempt(actions.renameTocItem(id, row.item.key, title))}
            onToggleHidden={() =>
              attempt(
                row.item.hidden
                  ? actions.showTocItem(id, row.item.key)
                  : actions.hideTocItem(id, row.item.key),
              )
            }
            onReset={() => attempt(actions.removeTocOverride(id, row.item.key))}
            onRemove={() => onRemove(row.item.key, (rows[i + 1] ?? rows[i - 1])?.item.key ?? null)}
            first={i === 0}
            last={i === rows.length - 1}
            dragging={drag?.key === row.item.key}
          />
        </li>
      ))}
    </ul>
  );
}

/** Keeps focus on something that is still there when an entry is removed or the pane switcher moves. */
export function useTocFocus(
  rows: Row[],
  stale: Parameters<typeof staleKeys>[0],
  list: RefObject<HTMLUListElement | null>,
  pane: TocPane,
) {
  const section = useRef<HTMLElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  /** An entry about to go away, and the row whose Actions button takes focus once it has (else Add custom entry). */
  const refocus = useRef<{ gone: string; to: string | null } | null>(null);
  const switched = useRef(false);
  useEffect(() => {
    const r = refocus.current;
    if (!r || rows.some((x) => x.item.key === r.gone) || staleKeys(stale).includes(r.gone)) return;
    refocus.current = null;
    const next = r.to
      ? list.current?.querySelector<HTMLElement>(
          `[data-toc-key="${CSS.escape(r.to)}"] [data-actions]`,
        )
      : null;
    (
      next ??
      section.current?.querySelector<HTMLElement>("[data-add-entry]") ??
      heading.current
    )?.focus();
  });
  useEffect(() => {
    // The switcher is drawn in a different place on each pane, so choosing a pane replaces the control that had focus.
    if (!switched.current) return;
    switched.current = false;
    section.current?.querySelector<HTMLElement>("[data-switcher] [data-state=on]")?.focus();
  }, [pane]);
  return { section, heading, refocus, switched };
}

export function EditHeader({ headingRef }: { headingRef: RefObject<HTMLHeadingElement | null> }) {
  const { t } = useLingui();
  return (
    <header className="flex flex-col gap-1">
      <h2
        ref={headingRef}
        tabIndex={-1}
        className="font-book text-title font-semibold focus:outline-none"
      >
        {t`Contents`}
      </h2>
      <p className="text-sm text-ink-muted">
        {t`The list follows your chapters. Rename, hide, reorder or add entries here; exports and the print preview use this list.`}
      </p>
    </header>
  );
}

export function EntryButtons({
  canAdd,
  changed,
  onAdd,
  onReset,
}: {
  canAdd: boolean;
  changed: boolean;
  onAdd: () => void;
  onReset: () => void;
}) {
  const { t } = useLingui();
  return (
    <div className="flex flex-wrap gap-2">
      <Button data-add-entry size="sm" icon={Plus} disabled={!canAdd} onClick={() => onAdd()}>
        {t`Add custom entry`}
      </Button>
      {/* aria-disabled, not disabled: the button keeps focus when the reset leaves nothing to reset. */}
      <Button
        size="sm"
        icon={RotateCcw}
        aria-disabled={!changed}
        className="aria-disabled:pointer-events-none aria-disabled:opacity-50"
        onClick={() => changed && onReset()}
      >
        {t`Reset to outline`}
      </Button>
    </div>
  );
}

export function PaneSwitcher({ pane, onPane }: { pane: TocPane; onPane: (pane: TocPane) => void }) {
  const { t } = useLingui();
  const panes: { value: TocPane; label: string }[] = [
    { value: "edit", label: t`Edit` },
    { value: "preview", label: t`Preview` },
  ];
  return (
    <div className="xl:hidden" data-switcher>
      <Segmented label={t`Contents view`} value={pane} items={panes} onChange={onPane} />
    </div>
  );
}
