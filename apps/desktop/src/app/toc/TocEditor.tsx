import { useEffect, useMemo, useRef, useState, type PointerEvent } from "react";
import { useLingui } from "@lingui/react/macro";
import { Plus, RotateCcw, X } from "lucide-react";
import type { EditionEntry, TocDepth } from "@cadabracraft/format";
import { attempt } from "../../state/attempt";
import { useProject } from "../../state/project/index";
import { dirFor } from "../../i18n/locales";
import { fontKindOf } from "../../lib/pageLayout";
import { contentsLayout, previewLines } from "../../lib/tocPreview";
import { dropPosition, insertionIndex, staleKeys, staleLabel } from "../../lib/tocView";
import { useTocPane, type TocPane } from "../../state/tocPane";
import { Button } from "../../ui/Button";
import { Confirm } from "../../ui/Dialog";
import { DropLine } from "../../ui/DropLine";
import { Segmented } from "../../ui/Segmented";
import { Switch } from "../../ui/Switch";
import { useIsXl } from "../hooks/useIsXl";
import { AddEntryDialog } from "./AddEntryDialog";
import { TocPreview } from "./TocPreview";
import { TocRow } from "./TocRow";
import { useToc } from "./useToc";
import { useTocPreview } from "./useTocPreview";

/**
 * The Contents page: replaces the text editor while a page of kind `contents` is open. The list is generated from the book's
 * outline; what the author changes here (depth, hidden, renamed, moved and added entries) is saved on the page as overrides.
 */
export function TocEditor({ entry }: { entry: EditionEntry }) {
  const { t } = useLingui();
  const actions = useProject((s) => s.actions);
  const manifest = useProject((s) => s.manifest)!;
  const { settings, items, rows, stale, language } = useToc(entry);
  // From `xl` the list and its preview sit side by side; below it one shows at a time (the choice is remembered).
  const wide = useIsXl();
  const pane = useTocPane((s) => s.pane);
  const setPane = useTocPane((s) => s.set);
  const showEdit = wide || pane === "edit";
  const showPreview = wide || pane === "preview";
  const layout = useMemo(() => contentsLayout(manifest), [manifest]);
  const lines = useMemo(
    () => previewLines(rows, settings.pageNumbers),
    [rows, settings.pageNumbers],
  );
  const title = entry.titles[language] ?? Object.values(entry.titles)[0] ?? t`Contents`;
  const before = manifest.frontMatter.findIndex((e) => e.id === entry.id);
  const rtl = dirFor(language) === "rtl";
  const approx = useMemo(
    () => ({ title, lines, layout, before, rtl }),
    [title, lines, layout, before, rtl],
  );
  const preview = useTocPreview(showPreview, approx);
  const id = entry.id;
  const [editing, setEditing] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [drag, setDrag] = useState<{ key: string; at: number } | null>(null);
  const at = useRef(0);
  const list = useRef<HTMLUListElement>(null);
  const section = useRef<HTMLElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  /** A moved entry is announced (the grip keeps focus and its name does not change, so nothing else would say it moved). */
  const [said, setSaid] = useState("");
  /** An entry about to go away, and the row whose Actions button takes focus once it has (else Add custom entry). */
  const refocus = useRef<{ gone: string; to: string | null } | null>(null);
  const switched = useRef(false);
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
  const move = (i: number, delta: number) => {
    const { item } = rows[i]!;
    attempt(actions.moveTocItem(id, items, item.key, i + delta));
    setSaid(t`Moved ${item.title} to position ${i + delta + 1} of ${rows.length}`);
  };
  /** Removes an override and puts focus on a row that is still there, so it does not fall to the page. */
  const remove = (key: string, to: string | null) => {
    refocus.current = { gone: key, to };
    attempt(actions.removeTocOverride(id, key));
  };
  const grab = (key: string, index: number) => (e: PointerEvent<HTMLElement>) => {
    e.preventDefault();
    at.current = index;
    setDrag({ key, at: index });
  };
  const depths: { value: `${TocDepth}`; label: string }[] = [
    { value: "0", label: t`Chapters` },
    { value: "1", label: t`+H1` },
    { value: "2", label: t`+H1-H2` },
    { value: "3", label: t`+H1-H3` },
  ];
  const changed =
    settings.hidden.length > 0 ||
    Object.keys(settings.titles).length > 0 ||
    settings.order !== undefined ||
    settings.custom.length > 0;
  const staleRows = staleKeys(stale);
  const panes: { value: TocPane; label: string }[] = [
    { value: "edit", label: t`Edit` },
    { value: "preview", label: t`Preview` },
  ];
  const switcher = (
    <div className="xl:hidden" data-switcher>
      <Segmented
        label={t`Contents view`}
        value={pane}
        items={panes}
        onChange={(v) => {
          switched.current = true;
          setPane({ pane: v });
        }}
      />
    </div>
  );
  return (
    <section
      ref={section}
      aria-label={t`Contents`}
      className="flex min-h-0 flex-1 flex-col xl:flex-row"
    >
      {showEdit && (
        <div className="min-h-0 min-w-0 flex-1 overflow-y-auto">
          <div className="mx-auto flex max-w-2xl flex-col gap-4 p-4 md:p-6">
            <header className="flex flex-col gap-1">
              <h2
                ref={heading}
                tabIndex={-1}
                className="font-book text-title font-semibold focus:outline-none"
              >
                {t`Contents`}
              </h2>
              <p className="text-sm text-ink-muted">
                {t`The list follows your chapters. Rename, hide, reorder or add entries here; exports and the print preview use this list.`}
              </p>
            </header>
            {switcher}
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
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                data-add-entry
                size="sm"
                icon={Plus}
                disabled={items.length === 0}
                onClick={() => setAdding(true)}
              >
                {t`Add custom entry`}
              </Button>
              {/* aria-disabled, not disabled: the button keeps focus when the reset leaves nothing to reset. */}
              <Button
                size="sm"
                icon={RotateCcw}
                aria-disabled={!changed}
                className="aria-disabled:pointer-events-none aria-disabled:opacity-50"
                onClick={() => changed && setResetting(true)}
              >
                {t`Reset to outline`}
              </Button>
            </div>
            {items.length === 0 ? (
              <p className="rounded-md border border-dashed border-border-strong p-6 text-center text-sm text-ink-muted">
                {t`Nothing to list yet. Add a chapter and it appears here.`}
              </p>
            ) : (
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
                      numbers={settings.pageNumbers}
                      editing={editing === row.item.key}
                      setEditing={(on) => setEditing(on ? row.item.key : null)}
                      onGrab={grab(row.item.key, i)}
                      onMove={(d) => move(i, d)}
                      onRename={(title) => attempt(actions.renameTocItem(id, row.item.key, title))}
                      onToggleHidden={() =>
                        attempt(
                          row.item.hidden
                            ? actions.showTocItem(id, row.item.key)
                            : actions.hideTocItem(id, row.item.key),
                        )
                      }
                      onReset={() => attempt(actions.removeTocOverride(id, row.item.key))}
                      onRemove={() =>
                        remove(row.item.key, (rows[i + 1] ?? rows[i - 1])?.item.key ?? null)
                      }
                      first={i === 0}
                      last={i === rows.length - 1}
                      dragging={drag?.key === row.item.key}
                    />
                  </li>
                ))}
              </ul>
            )}
            {staleRows.length > 0 && (
              <section aria-label={t`Changes that no longer match`} className="flex flex-col gap-2">
                <h3 className="text-sm font-semibold">{t`Changes that no longer match`}</h3>
                <p className="text-xs text-ink-muted">
                  {t`These changes belong to a chapter or heading that is gone or was edited. They are kept until you remove them.`}
                </p>
                <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
                  {staleRows.map((key) => {
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
                          onClick={() => remove(key, null)}
                        >
                          {t`Remove`}
                        </Button>
                      </li>
                    );
                  })}
                </ul>
              </section>
            )}
          </div>
        </div>
      )}
      {showPreview && (
        <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-3 p-4 md:p-6 xl:ps-0">
          {!showEdit && (
            <header className="flex flex-col gap-3">
              <h2 className="font-book text-title font-semibold">{t`Contents`}</h2>
              {switcher}
            </header>
          )}
          <TocPreview
            state={preview}
            lines={lines}
            layout={layout}
            serif={fontKindOf(manifest.template) === "serif"}
          />
        </div>
      )}
      <p aria-live="polite" className="sr-only">
        {said}
      </p>
      <AddEntryDialog
        open={adding}
        onOpenChange={setAdding}
        items={items}
        onAdd={(init) => actions.addTocCustom(id, init)}
      />
      <Confirm
        open={resetting}
        onOpenChange={setResetting}
        title={t`Reset the contents to the outline?`}
        description={t`Renamed, hidden, moved and custom entries are removed. The depth and the page-number setting stay.`}
        confirmLabel={t`Reset to outline`}
        onConfirm={() => attempt(actions.resetToc(id))}
      />
    </section>
  );
}
