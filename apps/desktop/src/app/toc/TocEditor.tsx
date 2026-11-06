import { useMemo, useState } from "react";
import { useLingui } from "@lingui/react/macro";
import type { EditionEntry } from "@cadabracraft/format";
import { attempt } from "../../state/attempt";
import { useProject } from "../../state/project/index";
import { staleKeys, tocMovePlace, tocMoveTarget } from "../../lib/toc/tocView";
import { useTocPane } from "../../state/view/tocPane";
import { Confirm } from "../../ui/Dialog";
import { useIsXl } from "../hooks/useIsXl";
import { AddEntryDialog } from "./AddEntryDialog";
import {
  EditHeader,
  EntryButtons,
  EntryRows,
  PaneSwitcher,
  SettingsBar,
  StaleChanges,
  useTocDrag,
  useTocFocus,
} from "./TocEditorParts";
import { TocPreview } from "./TocPreview";
import { useContentsView } from "./useContentsView";
import { useTocPreview } from "./useTocPreview";

/**
 * The Contents page: replaces the text editor while a page of kind `contents` is open. The list is generated from the book's
 * outline; what the author changes here (depth, hidden, renamed, moved and added entries) is saved on the page as overrides.
 */
export function TocEditor({ entry }: { entry: EditionEntry }) {
  const { t } = useLingui();
  const actions = useProject((s) => s.actions);
  const { settings, items, rows, stale, language, lines, layout, title, before, rtl, serif } =
    useContentsView(entry);
  // From `xl` the list and its preview sit side by side; below it one shows at a time (the choice is remembered).
  const wide = useIsXl();
  const pane = useTocPane((s) => s.pane);
  const setPane = useTocPane((s) => s.set);
  const showEdit = wide || pane === "edit";
  const showPreview = wide || pane === "preview";
  const approx = useMemo(
    () => ({ title, lines, layout, before, rtl }),
    [title, lines, layout, before, rtl],
  );
  const preview = useTocPreview(showPreview, approx);
  const id = entry.id;
  const [editing, setEditing] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [resetting, setResetting] = useState(false);
  const { drag, list, grab } = useTocDrag(items, id);
  /** A moved entry is announced (the grip keeps focus and its name does not change, so nothing else would say it moved). */
  const [said, setSaid] = useState("");
  const { section, heading, refocus, switched } = useTocFocus(rows, stale, list, pane);
  const move = (i: number, delta: number) => {
    const { item } = rows[i]!;
    const to = tocMoveTarget(items, i, delta);
    attempt(actions.moveTocItem(id, items, item.key, to));
    setSaid(t`Moved ${item.title} to position ${tocMovePlace(items, i, to) + 1} of ${rows.length}`);
  };
  /** Removes an override and puts focus on a row that is still there, so it does not fall to the page. */
  const remove = (key: string, to: string | null) => {
    refocus.current = { gone: key, to };
    attempt(actions.removeTocOverride(id, key));
  };
  const changed =
    settings.hidden.length > 0 ||
    Object.keys(settings.titles).length > 0 ||
    settings.order !== undefined ||
    settings.custom.length > 0;
  const staleRows = staleKeys(stale);
  const switcher = (
    <PaneSwitcher
      pane={pane}
      onPane={(v) => {
        switched.current = true;
        setPane({ pane: v });
      }}
    />
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
            <EditHeader headingRef={heading} />
            {switcher}
            <SettingsBar id={id} settings={settings} />
            <EntryButtons
              canAdd={items.length > 0}
              changed={changed}
              onAdd={() => setAdding(true)}
              onReset={() => setResetting(true)}
            />
            <EntryRows
              id={id}
              items={items}
              rows={rows}
              numbers={settings.pageNumbers}
              list={list}
              drag={drag}
              editing={editing}
              setEditing={setEditing}
              onGrab={grab}
              onMove={move}
              onRemove={remove}
            />
            <StaleChanges
              entry={entry}
              language={language}
              keys={staleRows}
              onRemove={(key) => remove(key, null)}
            />
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
          <TocPreview state={preview} lines={lines} layout={layout} serif={serif} />
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
