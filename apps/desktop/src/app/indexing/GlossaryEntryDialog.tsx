import { useState } from "react";
import { plural } from "@lingui/core/macro";
import { useLingui } from "@lingui/react/macro";
import type { GlossaryItem } from "@cadabracraft/shared";
import { Button } from "../../ui/Button";
import { Confirm, Modal } from "../../ui/Dialog";
import { Checkbox } from "../../ui/forms/Checkbox";
import { Field } from "../../ui/forms/Input";
import { Textarea } from "../../ui/forms/Textarea";
import { entryErrors } from "../../lib/indexing/problemText";
import { entryProblem, parseAliases } from "../../lib/indexing/validation";
import { attempt } from "../../state/attempt";
import { useProject } from "../../state/project/index";

interface Props {
  item: GlossaryItem | null;
  entries: readonly GlossaryItem[];
  onClose: () => void;
  onGo: (chapterId: string, entryId: string) => void;
}

/** The editor of one glossary entry: its term, other spellings and definition, where it is used, and deleting it. */
export function GlossaryEntryDialog(props: Props) {
  const { t } = useLingui();
  return (
    <Modal
      open={props.item !== null}
      onOpenChange={(o) => !o && props.onClose()}
      title={t`Glossary entry`}
      size="wide"
    >
      {props.item && <Form {...props} item={props.item} />}
    </Modal>
  );
}

function Form({ item, entries, onClose, onGo }: Props & { item: GlossaryItem }) {
  const { t } = useLingui();
  const actions = useProject((s) => s.actions);
  const { entry, use } = item;
  const [term, setTerm] = useState(entry.term);
  const [aliases, setAliases] = useState((entry.aliases ?? []).join(", "));
  const [definition, setDefinition] = useState(entry.definition);
  const [firstUse, setFirstUse] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [shown, setShown] = useState(false);
  const draft = { id: entry.id, term, aliases: parseAliases(aliases), definition };
  const problem = entryProblem(
    draft,
    entries.map((e) => e.entry),
  );
  const save = (e: React.FormEvent) => {
    e.preventDefault();
    setShown(true);
    if (problem) return;
    attempt(
      (async () => {
        const ok = await actions.updateGlossaryEntry(entry.id, {
          term: term.trim(),
          aliases: draft.aliases,
          definition,
        });
        if (ok && firstUse) await actions.markGlossaryOccurrences(entry.id, true);
      })(),
    );
    onClose();
  };
  const errors = entryErrors(problem, shown);
  return (
    <form className="flex flex-col gap-4" onSubmit={save}>
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
        rows={5}
        error={errors.definition}
        onChange={(e) => setDefinition(e.target.value)}
      />
      <Checkbox
        label={t`Mark first use in each chapter`}
        hint={t`Marks the first time the term or one of its other names appears in each chapter.`}
        checked={firstUse}
        onChange={(e) => setFirstUse(e.target.checked)}
      />
      <div className="flex items-center gap-2 rounded-md bg-bg p-2">
        <p className="min-w-0 flex-1 text-small">
          {use
            ? t`Used ${plural(use.count, { one: "# time", other: "# times" })} in ${plural(use.chapterIds.length, { one: "# chapter", other: "# chapters" })}`
            : t`Not used in the text yet`}
        </p>
        {use && (
          <Button
            size="sm"
            onClick={() => {
              onGo(use.first.chapterId, entry.id);
              onClose();
            }}
          >
            {t`Go to first use`}
          </Button>
        )}
      </div>
      <div className="flex flex-wrap justify-between gap-2.5">
        <Button variant="danger" onClick={() => setConfirm(true)}>
          {t`Delete term`}
        </Button>
        <div className="flex gap-2.5">
          <Button onClick={onClose}>{t`Cancel`}</Button>
          <Button type="submit" variant="primary">
            {t`Save`}
          </Button>
        </div>
      </div>
      <Confirm
        open={confirm}
        onOpenChange={setConfirm}
        title={t`Delete this glossary term?`}
        description={t`“${entry.term}” leaves the glossary and every use of it is unmarked. The words stay in your pages. This cannot be undone.`}
        confirmLabel={t`Delete term`}
        onConfirm={() => {
          attempt(actions.removeGlossaryEntry(entry.id));
          onClose();
        }}
      />
    </form>
  );
}
