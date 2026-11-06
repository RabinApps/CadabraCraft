import { useState } from "react";
import { useLingui } from "@lingui/react/macro";
import { entryRowsIn, readingOrder, sourceEdition, type Reference } from "@cadabracraft/format";
import { BookOpen, Trash2, X } from "lucide-react";
import { attempt } from "../../state/attempt";
import { useProject } from "../../state/project/index";
import { Button } from "../../ui/Button";
import { Chip } from "../../ui/feedback/Chip";
import { Field } from "../../ui/forms/Input";
import { Select } from "../../ui/forms/Select";
import { cx } from "../../ui/cx";

/** The reference's title, note, tags and linked pages, saved as they change, and the button that removes it. */
export function ReferenceDetails({
  reference,
  onRemoved,
}: {
  reference: Reference;
  onRemoved: () => void;
}) {
  const { t } = useLingui();
  const manifest = useProject((s) => s.manifest)!;
  const activeLanguage = useProject((s) => s.activeLanguage);
  const language = activeLanguage ?? sourceEdition(manifest.editions).language;
  const actions = useProject((s) => s.actions);
  const [title, setTitle] = useState(reference.title);
  const [note, setNote] = useState(reference.note);
  const [tag, setTag] = useState("");
  const pages = entryRowsIn(readingOrder(manifest), manifest.editions, language);
  const titleOf = (id: string) => pages.find((p) => p.id === id)?.title ?? id;
  const update = (patch: Parameters<typeof actions.updateReference>[1]) =>
    attempt(actions.updateReference(reference.id, patch));
  const addTag = () => {
    const next = tag.trim();
    setTag("");
    if (next && !reference.tags.includes(next)) update({ tags: [...reference.tags, next] });
  };
  const unlinked = pages.filter((p) => !reference.chapters.includes(p.id));
  return (
    <div className="flex flex-col gap-4 p-5">
      <Field
        label={t`Title`}
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onBlur={() =>
          title.trim()
            ? title !== reference.title && update({ title: title.trim() })
            : setTitle(reference.title)
        }
      />
      <div className="flex flex-col gap-1.5">
        <label
          htmlFor="reference-note"
          className="text-xs font-semibold text-ink-muted"
        >{t`Note`}</label>
        <textarea
          id="reference-note"
          rows={4}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          onBlur={() => note !== reference.note && update({ note })}
          className="w-full resize-y rounded-md border border-border-strong bg-surface px-3 py-2.5 text-sm text-ink focus-visible:outline-2 focus-visible:outline-accent"
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <span className="text-xs font-semibold text-ink-muted">{t`Tags`}</span>
        <div className="flex flex-wrap gap-1.5">
          {reference.tags.map((name) => (
            <Chip
              key={name}
              pressed
              aria-label={t`Remove tag ${name}`}
              onClick={() => update({ tags: reference.tags.filter((x) => x !== name) })}
            >
              {name}
              <X size={12} className="ms-1 inline" aria-hidden />
            </Chip>
          ))}
        </div>
        <Field
          label={t`Add a tag`}
          hideLabel
          placeholder={t`Add a tag`}
          value={tag}
          onChange={(e) => setTag(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              addTag();
            }
          }}
          onBlur={addTag}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <span className="text-xs font-semibold text-ink-muted">{t`Linked chapters`}</span>
        <ul className="flex flex-col gap-1.5">
          {reference.chapters.map((id) => (
            <li key={id} className="flex items-center gap-2 rounded-md bg-bg px-2.5 py-1.5 text-sm">
              <BookOpen size={14} className="text-ink-muted" aria-hidden />
              <span className="min-w-0 flex-1 truncate">{titleOf(id)}</span>
              <button
                type="button"
                aria-label={t`Unlink ${titleOf(id)}`}
                className={cx(
                  "text-ink-muted hover:text-ink focus-visible:outline-2 focus-visible:outline-accent",
                )}
                onClick={() => update({ chapters: reference.chapters.filter((x) => x !== id) })}
              >
                <X size={14} aria-hidden />
              </button>
            </li>
          ))}
        </ul>
        {unlinked.length > 0 && (
          <Select
            label={t`Link to a chapter`}
            hideLabel
            value=""
            onChange={(e) => update({ chapters: [...reference.chapters, e.target.value] })}
          >
            <option value="" disabled>{t`Link to a chapter…`}</option>
            {unlinked.map((p) => (
              <option key={p.id} value={p.id}>
                {p.title}
              </option>
            ))}
          </Select>
        )}
      </div>
      <Button
        variant="secondary"
        icon={Trash2}
        className="mt-auto text-danger"
        onClick={() => {
          attempt(actions.removeReference(reference.id));
          onRemoved();
        }}
      >{t`Remove from book`}</Button>
    </div>
  );
}
