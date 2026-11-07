import { useLingui } from "@lingui/react/macro";
import type { ReferenceFilter, ReferenceKind } from "../../../lib/references/referenceKinds";
import { Chip } from "../../../ui/feedback/Chip";

export function Filters({
  filter,
  onChange,
  tags,
}: {
  filter: ReferenceFilter;
  onChange: (filter: ReferenceFilter) => void;
  tags: string[];
}) {
  const { t } = useLingui();
  const kinds: [ReferenceKind | "all", string][] = [
    ["all", t`All`],
    ["image", t`Images`],
    ["video", t`Video`],
    ["pdf", t`PDF`],
    ["audio", t`Audio`],
    ["text", t`Documents`],
    ["link", t`Links`],
    ["note", t`Notes`],
    ["other", t`Other`],
  ];
  return (
    <>
      <div role="group" aria-label={t`Filter by type`} className="flex flex-wrap gap-1.5">
        {kinds.map(([kind, label]) => (
          <Chip
            key={kind}
            pressed={filter.kind === kind}
            onClick={() => onChange({ ...filter, kind })}
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
              onClick={() => onChange({ ...filter, tag: filter.tag === tag ? null : tag })}
            >
              {`#${tag}`}
            </Chip>
          ))}
        </div>
      )}
    </>
  );
}
