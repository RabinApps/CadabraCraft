import { useLingui } from "@lingui/react/macro";
import { referencesFor } from "@cadabracraft/format";
import { kindOf } from "../../lib/references/referenceKinds";
import { attempt } from "../../state/attempt";
import { useProject } from "../../state/project/index";
import { SectionHeading } from "../../ui/SectionHeading";
import { Select } from "../../ui/forms/Select";
import { kindIcon } from "./ReferenceRow";

/** The references linked to the open page, with a menu to link more. Part of the Details panel. */
export function ChapterReferences({ onOpen }: { onOpen: (id: string) => void }) {
  const { t } = useLingui();
  const manifest = useProject((s) => s.manifest)!;
  const currentId = useProject((s) => s.currentId);
  const actions = useProject((s) => s.actions);
  if (!currentId || manifest.references.length === 0) return null;
  const linked = referencesFor(manifest, currentId);
  const free = manifest.references.filter((r) => !r.chapters.includes(currentId));
  return (
    <section aria-labelledby="details-references">
      <SectionHeading id="details-references">{t`References`}</SectionHeading>
      <ul className="mb-2 flex flex-col gap-1.5">
        {linked.map((r) => {
          const Icon = kindIcon(kindOf(r));
          return (
            <li key={r.id}>
              <button
                type="button"
                onClick={() => onOpen(r.id)}
                className="flex w-full items-center gap-2 rounded-md bg-bg px-2.5 py-2 text-start text-sm hover:bg-accent-soft focus-visible:outline-2 focus-visible:outline-accent"
              >
                <Icon size={16} className="shrink-0 text-accent" aria-hidden />
                <span className="min-w-0 flex-1 truncate">{r.title}</span>
              </button>
            </li>
          );
        })}
      </ul>
      {free.length > 0 && (
        <Select
          label={t`Link a reference`}
          hideLabel
          value=""
          onChange={(e) => {
            const r = manifest.references.find((x) => x.id === e.target.value)!;
            attempt(actions.updateReference(r.id, { chapters: [...r.chapters, currentId] }));
          }}
        >
          <option value="" disabled>{t`Link a reference…`}</option>
          {free.map((r) => (
            <option key={r.id} value={r.id}>
              {r.title}
            </option>
          ))}
        </Select>
      )}
    </section>
  );
}
