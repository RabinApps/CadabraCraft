import { useMemo, useState } from "react";
import { plural } from "@lingui/core/macro";
import { useLingui } from "@lingui/react/macro";
import { BookA, Plus, SlidersHorizontal, X } from "lucide-react";
import { termKey, type IndexPlace } from "@cadabracraft/shared";
import { Button, IconButton } from "../../ui/Button";
import { Chip } from "../../ui/feedback/Chip";
import { Field } from "../../ui/forms/Input";
import { useMarkAnchor } from "../../lib/indexing/anchor";
import {
  danglingTargets,
  filterIndex,
  termCount,
  type IndexFilter,
} from "../../lib/indexing/panelModel";
import { useProject } from "../../state/project/index";
import { IndexSettingsDialog } from "./IndexSettingsDialog";
import { IndexTermCard } from "./IndexTermCard";
import { IndexTermDialog } from "./IndexTermDialog";
import { useBookIndex } from "./useIndexData";
import { useGoTo } from "./useGoTo";

const NONE: string[] = [];

/** The back-of-book index rail: every term marked in the book with its places, cross-references and a way to edit each. */
export function IndexPanel({ onClose, onJump }: { onClose?: () => void; onJump?: () => void }) {
  const { t } = useLingui();
  const { pages, data } = useBookIndex(true);
  const hiddenTerms = useProject((s) => s.manifest?.index?.hidden) ?? NONE;
  const openIndex = useMarkAnchor((s) => s.openIndex);
  const hasSelection = useMarkAnchor((s) => s.hasSelection);
  const goTo = useGoTo();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<IndexFilter>("all");
  const [editing, setEditing] = useState<string | null>(null);
  const [settings, setSettings] = useState(false);
  const titles = useMemo(() => new Map((pages ?? []).map((p) => [p.id, p.title])), [pages]);
  const tree = data?.tree;
  const groups = useMemo(
    () => (tree ? filterIndex(tree, query, filter) : []),
    [tree, query, filter],
  );
  const editingTerm =
    tree?.groups.flatMap((g) => g.terms).find((x) => editing && termKey(x.term) === editing) ??
    null;
  const total = tree ? termCount(tree) : 0;
  const go = (place: IndexPlace) => {
    goTo({ chapterId: place.chapterId, kind: "index", id: place.id });
    onJump?.();
  };
  return (
    <section aria-label={t`Index`} className="flex h-full min-h-0 flex-col gap-3 p-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-lead font-semibold">{t`Index`}</h2>
        <div className="flex items-center gap-1">
          <span className="rounded-full bg-accent-soft px-2 py-0.5 text-caption font-semibold text-accent">
            {plural(total, { one: "# term", other: "# terms" })}
          </span>
          <IconButton
            icon={SlidersHorizontal}
            label={t`Index settings`}
            onClick={() => setSettings(true)}
          />
          {onClose && <IconButton icon={X} label={t`Close index`} onClick={onClose} />}
        </div>
      </div>
      <Field
        label={t`Search the index`}
        hideLabel
        type="search"
        placeholder={t`Search terms`}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      <div role="group" aria-label={t`Filter the index`} className="flex flex-wrap gap-1.5">
        <Chip pressed={filter === "all"} onClick={() => setFilter("all")}>
          {t`All`}
        </Chip>
        <Chip pressed={filter === "attention"} onClick={() => setFilter("attention")}>
          {t`Needs attention`}
        </Chip>
        <Chip pressed={filter === "xrefs"} onClick={() => setFilter("xrefs")}>
          {t`Cross-refs`}
        </Chip>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {!data ? (
          <p className="py-6 text-center text-sm text-ink-muted">{t`Reading the book…`}</p>
        ) : total === 0 ? (
          <div className="flex flex-col items-center gap-2 py-6 text-center">
            <span className="flex size-12 items-center justify-center rounded-full bg-accent-soft text-accent">
              <BookA size={22} aria-hidden />
            </span>
            <p className="text-sm text-ink-muted">
              {t`No index entries yet. Select words in the text and choose Add selection.`}
            </p>
          </div>
        ) : groups.length === 0 ? (
          <p className="py-6 text-center text-sm text-ink-muted">{t`No terms match.`}</p>
        ) : (
          groups.map((g) => (
            <section key={g.letter} aria-label={g.letter} className="mb-3">
              <h3 className="mb-1.5 font-book text-lead font-semibold text-ink-muted">
                {g.letter}
              </h3>
              <ul className="flex flex-col gap-2">
                {g.terms.map((x) => (
                  <IndexTermCard
                    key={termKey(x.term)}
                    term={x}
                    dangling={danglingTargets(tree!, x.term)}
                    hidden={hiddenTerms.some((h) => termKey(h) === termKey(x.term))}
                    onEdit={() => setEditing(termKey(x.term))}
                    onGo={go}
                  />
                ))}
              </ul>
            </section>
          ))
        )}
      </div>
      <Button
        variant="primary"
        icon={Plus}
        disabled={!hasSelection || !openIndex}
        onClick={() => openIndex?.()}
      >
        {t`Add selection`}
      </Button>
      {tree && (
        <IndexTermDialog
          term={editingTerm}
          tree={tree}
          titles={titles}
          hidden={
            editingTerm ? hiddenTerms.some((h) => termKey(h) === termKey(editingTerm.term)) : false
          }
          onClose={() => setEditing(null)}
          onGo={go}
        />
      )}
      <IndexSettingsDialog open={settings} onClose={() => setSettings(false)} />
    </section>
  );
}
