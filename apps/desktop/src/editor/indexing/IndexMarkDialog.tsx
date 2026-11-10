import { useState } from "react";
import { useLingui } from "@lingui/react/macro";
import { termKey } from "@cadabracraft/shared";
import { Button } from "../../ui/Button";
import { Modal } from "../../ui/Dialog";
import { Checkbox } from "../../ui/forms/Checkbox";
import { Field } from "../../ui/forms/Input";
import { Segmented } from "../../ui/forms/Segmented";
import { termProblemText } from "../../lib/indexing/problemText";
import { useIndexLookups } from "./useIndexLookups";
import { termProblem } from "../../lib/indexing/validation";

/** The words selected when the dialog was opened and where they are in the page. */
export interface MarkSelection {
  text: string;
  from: number;
  to: number;
}

export interface IndexMarkValues {
  term: string;
  sub?: string;
  see?: string;
  seeAlso?: string;
  /** Also mark every other place in the book that has the selected words. */
  markAll: boolean;
}

type Points = "page" | "see" | "seeAlso";

/** The one-line text a selection offers as a term: itself when it is short, else nothing. */
const termFrom = (text: string): string => {
  const one = text.replace(/\s+/g, " ").trim();
  return one.length <= 120 ? one : "";
};

/**
 * The popover that marks the selected words for the back-of-book index: the term they are listed under, an optional subentry, and
 * whether the entry points to this page or to another term (See, See also). It is a dialog so the focus stays inside it.
 */
export function IndexMarkDialog({
  selection,
  onClose,
  onSubmit,
}: {
  selection: MarkSelection | null;
  onClose: () => void;
  onSubmit: (values: IndexMarkValues) => void;
}) {
  const { t } = useLingui();
  return (
    <Modal
      open={selection !== null}
      onOpenChange={(open) => !open && onClose()}
      title={t`Index entry`}
      description={t`Choose how the selected words are listed in the index at the end of the book.`}
    >
      {selection && <Form selection={selection} onClose={onClose} onSubmit={onSubmit} />}
    </Modal>
  );
}

function Form({
  selection,
  onClose,
  onSubmit,
}: {
  selection: MarkSelection;
  onClose: () => void;
  onSubmit: (values: IndexMarkValues) => void;
}) {
  const { t } = useLingui();
  const [term, setTerm] = useState(termFrom(selection.text));
  const [sub, setSub] = useState("");
  const [points, setPoints] = useState<Points>("page");
  const [target, setTarget] = useState("");
  const [markAll, setMarkAll] = useState(false);
  const [shown, setShown] = useState(false);
  const words = selection.text.trim();
  const { found, known } = useIndexLookups(words, term, sub);
  const problem = (value: string, required: boolean): string | undefined => {
    if (!required && value.trim() === "") return undefined;
    const p = termProblem(value);
    return p ? termProblemText(p) : undefined;
  };
  const errors = {
    term: problem(term, true),
    sub: problem(sub, false),
    target:
      points === "page"
        ? undefined
        : (problem(target, true) ??
          (termKey(target) === termKey(term) ? t`Point to a different term.` : undefined)),
  };
  const invalid = Boolean(errors.term || errors.sub || errors.target);
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setShown(true);
    if (invalid) return;
    onSubmit({
      term: term.trim(),
      ...(sub.trim() ? { sub: sub.trim() } : {}),
      ...(points === "see" ? { see: target.trim() } : {}),
      ...(points === "seeAlso" ? { seeAlso: target.trim() } : {}),
      markAll,
    });
  };
  return (
    <form className="flex flex-col gap-4" onSubmit={submit}>
      <p
        className="rounded-sm bg-accent-soft p-2 font-book text-small"
        data-testid="index-selection"
      >
        {words}
      </p>
      <Field
        label={t`Term`}
        value={term}
        list="index-terms"
        autoFocus
        error={shown ? errors.term : undefined}
        onChange={(e) => setTerm(e.target.value)}
        hint={t`The heading the words are listed under.`}
      />
      <Field
        label={t`Sub-entry (optional)`}
        value={sub}
        error={shown ? errors.sub : undefined}
        onChange={(e) => setSub(e.target.value)}
      />
      <div className="flex flex-col gap-1.5">
        <span aria-hidden className="text-xs font-semibold text-ink-muted">
          {t`Points to`}
        </span>
        <Segmented<Points>
          label={t`Points to`}
          value={points}
          onChange={setPoints}
          items={[
            { value: "page", label: t`This page` },
            { value: "see", label: t`See` },
            { value: "seeAlso", label: t`See also` },
          ]}
        />
      </div>
      {points !== "page" && (
        <Field
          label={t`Target term`}
          value={target}
          list="index-terms"
          error={shown ? errors.target : undefined}
          onChange={(e) => setTarget(e.target.value)}
          hint={t`The term the reader is sent to.`}
        />
      )}
      <datalist id="index-terms">
        {known.map((k) => (
          <option key={k} value={k} />
        ))}
      </datalist>
      <Checkbox
        label={t`Mark all occurrences`}
        hint={t`${found} found in the book`}
        checked={markAll}
        onChange={(e) => setMarkAll(e.target.checked)}
      />
      <div className="flex justify-end gap-2.5">
        <Button onClick={onClose}>{t`Cancel`}</Button>
        <Button type="submit" variant="primary">
          {t`Add`}
        </Button>
      </div>
    </form>
  );
}
