import { useMemo, useState } from "react";
import { useLingui } from "@lingui/react/macro";
import { Grid2x2, List, Plus, Upload, X } from "lucide-react";
import { allTags, filterReferences, NO_FILTER, type ReferenceKind } from "../../lib/referenceKinds";
import { attempt } from "../../state/attempt";
import { useProject } from "../../state/project/index";
import { Button, IconButton } from "../../ui/Button";
import { Chip } from "../../ui/Chip";
import { Field } from "../../ui/Input";
import { Notice } from "../../ui/Notice";
import { ProgressBar } from "../../ui/ProgressBar";
import { ReferenceRow } from "./ReferenceRow";
import { useReferenceDrop } from "./useReferenceDrop";

interface Props {
  /** The reference shown in the viewer, if any. */
  openId?: string | null;
  onOpen: (id: string) => void;
}

/** The author's reference library: search, filter by kind and tag, add files, and open one in the viewer. */
export function ReferencesPanel({ openId, onOpen }: Props) {
  const { t } = useLingui();
  const references = useProject((s) => s.manifest!.references);
  const notices = useProject((s) => s.referenceNotices);
  const importing = useProject((s) => s.referenceImport);
  const actions = useProject((s) => s.actions);
  const [filter, setFilter] = useState(NO_FILTER);
  const [grid, setGrid] = useState(false);
  useReferenceDrop();
  const tags = useMemo(() => allTags(references), [references]);
  const shown = useMemo(() => filterReferences(references, filter), [references, filter]);
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
        <Button variant="primary" size="sm" icon={Plus} onClick={add}>{t`Add files`}</Button>
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
          <ul className={grid ? "grid grid-cols-2 gap-2" : "flex flex-col gap-2"}>
            {shown.map((r) => (
              <li key={r.id} className="min-w-0">
                <ReferenceRow
                  reference={r}
                  selected={r.id === openId}
                  onOpen={() => onOpen(r.id)}
                />
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
    </section>
  );
}
