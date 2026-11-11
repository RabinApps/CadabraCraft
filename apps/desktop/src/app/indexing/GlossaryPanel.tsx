import { useMemo, useState } from "react";
import { plural } from "@lingui/core/macro";
import { useLingui } from "@lingui/react/macro";
import { BookMarked, Plus, Settings2, TriangleAlert, X } from "lucide-react";
import { Button, IconButton } from "../../ui/Button";
import { Chip } from "../../ui/feedback/Chip";
import { Field } from "../../ui/forms/Input";
import { useMarkAnchor } from "../../lib/indexing/anchor";
import { filterGlossary, type GlossaryFilter } from "../../lib/indexing/panelModel";
import { GlossaryEntryDialog } from "./GlossaryEntryDialog";
import { GlossarySettingsDialog } from "./GlossarySettingsDialog";
import { useBookIndex } from "./useIndexData";
import { useGoTo } from "./useGoTo";

/** The glossary rail: the book's terms with their definitions and where each is used. */
export function GlossaryPanel({ onClose, onJump }: { onClose?: () => void; onJump?: () => void }) {
  const { t } = useLingui();
  const { data } = useBookIndex(true);
  const openGlossary = useMarkAnchor((s) => s.openGlossary);
  const goTo = useGoTo();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<GlossaryFilter>("all");
  const [editing, setEditing] = useState<string | null>(null);
  const [settings, setSettings] = useState(false);
  const items = data?.glossary.items ?? [];
  // Every entry is listed, with a badge on the ones that have no definition; "show terms with no definition" is about the printed page.
  const listed = useMemo(() => filterGlossary(items, query, filter), [items, query, filter]);
  const editingItem = items.find((i) => i.entry.id === editing) ?? null;
  return (
    <section aria-label={t`Glossary`} className="flex h-full min-h-0 flex-col gap-3 p-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-lead font-semibold">{t`Glossary`}</h2>
        <div className="flex items-center gap-1">
          <span className="rounded-full bg-accent-soft px-2 py-0.5 text-caption font-semibold text-accent">
            {plural(items.length, { one: "# term", other: "# terms" })}
          </span>
          <IconButton
            icon={Settings2}
            label={t`Glossary settings`}
            onClick={() => setSettings(true)}
          />
          {onClose && <IconButton icon={X} label={t`Close glossary`} onClick={onClose} />}
        </div>
      </div>
      <Field
        label={t`Search the glossary`}
        hideLabel
        type="search"
        placeholder={t`Search terms`}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      <div role="group" aria-label={t`Filter the glossary`} className="flex flex-wrap gap-1.5">
        <Chip pressed={filter === "all"} onClick={() => setFilter("all")}>
          {t`All`}
        </Chip>
        <Chip pressed={filter === "undefined"} onClick={() => setFilter("undefined")}>
          {t`No definition`}
        </Chip>
        <Chip pressed={filter === "unused"} onClick={() => setFilter("unused")}>
          {t`Unused`}
        </Chip>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {!data ? (
          <p className="py-6 text-center text-sm text-ink-muted">{t`Reading the book…`}</p>
        ) : items.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-6 text-center">
            <span className="flex size-12 items-center justify-center rounded-full bg-accent-soft text-accent">
              <BookMarked size={22} aria-hidden />
            </span>
            <p className="text-sm text-ink-muted">
              {t`No glossary terms yet. Select a word in the text and choose Add term.`}
            </p>
          </div>
        ) : listed.length === 0 ? (
          <p className="py-6 text-center text-sm text-ink-muted">{t`No terms match.`}</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {listed.map(({ entry, use }) => (
              <li key={entry.id} className="flex flex-col gap-1 rounded-md bg-bg p-3">
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    aria-label={t`Edit glossary entry ${entry.term}`}
                    onClick={() => setEditing(entry.id)}
                    className="min-w-0 flex-1 truncate rounded-sm text-start font-book font-semibold focus-visible:outline-2 focus-visible:outline-accent"
                  >
                    {entry.term}
                  </button>
                  <span className="shrink-0 rounded-full bg-accent-soft px-2 py-0.5 text-caption font-semibold text-accent">
                    {plural(use?.count ?? 0, { one: "# use", other: "# uses" })}
                  </span>
                </div>
                {entry.definition.trim() === "" ? (
                  <p className="flex items-center gap-1 self-start rounded-full bg-warn-soft px-2 py-0.5 text-caption font-semibold text-warn">
                    <TriangleAlert size={12} aria-hidden />
                    {t`Needs a definition`}
                  </p>
                ) : (
                  <p className="line-clamp-3 text-small text-ink-muted">{entry.definition}</p>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
      <Button
        variant="primary"
        icon={Plus}
        disabled={!openGlossary}
        onClick={() => openGlossary?.()}
      >
        {t`Add term`}
      </Button>
      <GlossaryEntryDialog
        item={editingItem}
        entries={items}
        onClose={() => setEditing(null)}
        onGo={(chapterId, id) => {
          goTo({ chapterId, kind: "glossary", id });
          onJump?.();
        }}
      />
      <GlossarySettingsDialog open={settings} onClose={() => setSettings(false)} />
    </section>
  );
}
