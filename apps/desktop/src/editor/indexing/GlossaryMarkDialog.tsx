import { useState } from "react";
import { useLingui } from "@lingui/react/macro";
import { termKey, type GlossaryEntry } from "@cadabracraft/shared";
import { Button } from "../../ui/Button";
import { Modal } from "../../ui/Dialog";
import { Checkbox } from "../../ui/forms/Checkbox";
import { Field } from "../../ui/forms/Input";
import { Select } from "../../ui/forms/Select";
import { Textarea } from "../../ui/forms/Textarea";
import { entryErrors } from "../../lib/indexing/problemText";
import { entryProblem, parseAliases } from "../../lib/indexing/validation";
import type { MarkSelection } from "./IndexMarkDialog";

export interface GlossaryMarkValues {
  /** An existing entry's id, or the new entry to add. */
  entry: { id: string } | { term: string; aliases: string[]; definition: string };
  /** Also mark the first use of the term in each chapter. */
  firstUse: boolean;
}

const NEW = "";

/** The entry whose term or alias is the selected words, if there is one. */
const entryFor = (entries: readonly GlossaryEntry[], words: string): GlossaryEntry | undefined =>
  entries.find((e) => [e.term, ...(e.aliases ?? [])].some((x) => termKey(x) === termKey(words)));

/**
 * Adds a term to the glossary and marks the selected words as a use of it. `selection` is null when nothing was selected: the term
 * is then only added to the glossary. An existing entry can be chosen instead of a new one.
 */
export function GlossaryMarkDialog({
  open,
  selection,
  entries,
  onClose,
  onSubmit,
}: {
  open: boolean;
  selection: MarkSelection | null;
  entries: readonly GlossaryEntry[];
  onClose: () => void;
  onSubmit: (values: GlossaryMarkValues) => void;
}) {
  const { t } = useLingui();
  return (
    <Modal
      open={open}
      onOpenChange={(o) => !o && onClose()}
      title={t`Glossary term`}
      description={
        selection
          ? t`Add the selected words to the glossary, or mark them as a term that is already there.`
          : t`Add a term to the glossary.`
      }
    >
      {open && (
        <Form selection={selection} entries={entries} onClose={onClose} onSubmit={onSubmit} />
      )}
    </Modal>
  );
}

function Form({
  selection,
  entries,
  onClose,
  onSubmit,
}: {
  selection: MarkSelection | null;
  entries: readonly GlossaryEntry[];
  onClose: () => void;
  onSubmit: (values: GlossaryMarkValues) => void;
}) {
  const { t } = useLingui();
  const words = selection?.text.replace(/\s+/g, " ").trim() ?? "";
  const [chosen, setChosen] = useState(entryFor(entries, words)?.id ?? NEW);
  const [term, setTerm] = useState(words.length <= 120 ? words : "");
  const [aliases, setAliases] = useState("");
  const [definition, setDefinition] = useState("");
  const [firstUse, setFirstUse] = useState(false);
  const [shown, setShown] = useState(false);
  const adding = chosen === NEW;
  const draft = { id: "", term, aliases: parseAliases(aliases), definition };
  const problem = adding ? entryProblem(draft, entries) : null;
  const errors = entryErrors(problem, shown);
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setShown(true);
    if (problem) return;
    onSubmit({
      entry: adding ? { term: term.trim(), aliases: draft.aliases, definition } : { id: chosen },
      firstUse,
    });
  };
  return (
    <form className="flex flex-col gap-4" onSubmit={submit}>
      {words && (
        <p
          className="rounded-sm bg-accent-soft p-2 font-book text-small"
          data-testid="glossary-selection"
        >
          {words}
        </p>
      )}
      {entries.length > 0 && (
        <Select
          label={t`Glossary entry`}
          value={chosen}
          onChange={(e) => setChosen(e.target.value)}
        >
          <option value={NEW}>{t`New entry`}</option>
          {entries.map((e) => (
            <option key={e.id} value={e.id}>
              {e.term}
            </option>
          ))}
        </Select>
      )}
      {adding && (
        <>
          <Field
            label={t`Term`}
            value={term}
            autoFocus
            error={errors.term}
            onChange={(e) => setTerm(e.target.value)}
          />
          <Field
            label={t`Also called`}
            value={aliases}
            error={errors.aliases}
            onChange={(e) => setAliases(e.target.value)}
            hint={t`Other spellings and plurals, separated by commas.`}
          />
          <Textarea
            label={t`Definition`}
            value={definition}
            rows={4}
            error={errors.definition}
            onChange={(e) => setDefinition(e.target.value)}
            hint={t`A term with no definition is not printed in the glossary.`}
          />
        </>
      )}
      <Checkbox
        label={t`Mark first use in each chapter`}
        checked={firstUse}
        onChange={(e) => setFirstUse(e.target.checked)}
      />
      <div className="flex justify-end gap-2.5">
        <Button onClick={onClose}>{t`Cancel`}</Button>
        <Button type="submit" variant="primary">
          {selection ? (adding ? t`Add and mark` : t`Mark`) : t`Add term`}
        </Button>
      </div>
    </form>
  );
}
