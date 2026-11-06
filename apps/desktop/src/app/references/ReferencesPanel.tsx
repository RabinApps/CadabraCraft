import { useEffect, useMemo, useState } from "react";
import { useLingui } from "@lingui/react/macro";
import { plural } from "@lingui/core/macro";
import { ArchiveRestore, ArrowUpDown, Grid2x2, List, X } from "lucide-react";
import {
  allTags,
  canReorder,
  filterReferences,
  NO_FILTER,
  sortReferences,
  type SortKey,
} from "../../lib/references/referenceKinds";
import { useProject } from "../../state/project/index";
import { Button, IconButton } from "../../ui/Button";
import { Field } from "../../ui/forms/Input";
import { cx } from "../../ui/cx";
import { AddMenu } from "./add/AddMenu";
import { DropZone, EmptyReferences, ImportProgress, Notices } from "./panel/PanelParts";
import { Filters } from "./panel/ReferenceFilters";
import { SortMenu } from "./panel/SortMenu";
import { ReferenceList } from "./panel/ReferenceList";
import { RemovedReferencesDialog } from "./RemovedReferencesDialog";
import { Notice } from "../../ui/feedback/Notice";
import { useReferenceDrop } from "./useReferenceDrop";

interface Props {
  /** The reference shown in the viewer, if any. */
  openId?: string | null;
  onOpen: (id: string) => void;
  /** Given when the panel is a drawer: shows a close button next to Add. */
  onClose?: () => void;
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
  const { dropActive, targetProps } = useReferenceDrop();
  const [sort, setSort] = useState<SortKey>("manual");
  const [removedOpen, setRemovedOpen] = useState(false);
  const [linkError, setLinkError] = useState("");
  const removedCount = useProject((s) => s.removedReferences.length);
  useEffect(() => {
    void actions.refreshRemovedReferences();
  }, [actions]);
  const manual = sort === "manual";
  const reorderable = canReorder(filter) && !grid && manual;
  const tags = useMemo(() => allTags(references), [references]);
  const shown = useMemo(
    () => sortReferences(filterReferences(references, filter), sort),
    [references, filter, sort],
  );
  return (
    <section
      aria-label={t`References`}
      data-drop-active={dropActive || undefined}
      {...targetProps}
      className={cx(
        "flex h-full min-h-0 flex-col gap-3 p-4",
        dropActive &&
          "outline-2 -outline-offset-2 outline-accent forced-colors:outline-[Highlight]",
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-lead font-semibold">{t`References`}</h2>
        <div className="flex items-center gap-1">
          <AddMenu />
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
        <SortMenu sort={sort} onChange={setSort} />
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
      <Filters filter={filter} onChange={setFilter} tags={tags} />
      {importing && <ImportProgress importing={importing} />}
      <Notices notices={notices} />
      {linkError && <Notice role="alert">{linkError}</Notice>}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {references.length === 0 ? (
          <EmptyReferences />
        ) : shown.length === 0 ? (
          <p className="py-6 text-center text-sm text-ink-muted">{t`No references match.`}</p>
        ) : (
          <ReferenceList
            references={references}
            shown={shown}
            grid={grid}
            reorderable={reorderable}
            dropActive={dropActive}
            openId={openId}
            onOpen={onOpen}
            onLinkError={setLinkError}
          />
        )}
      </div>
      <DropZone active={dropActive} />
      {removedCount > 0 && (
        <Button variant="ghost" icon={ArchiveRestore} onClick={() => setRemovedOpen(true)}>
          {t`Removed references (${removedCount})`}
        </Button>
      )}
      <RemovedReferencesDialog open={removedOpen} onOpenChange={setRemovedOpen} />
    </section>
  );
}
