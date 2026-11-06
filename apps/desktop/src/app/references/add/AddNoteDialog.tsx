import { useState } from "react";
import { useLingui } from "@lingui/react/macro";
import { MAX_NOTE_CHARS } from "@cadabracraft/format";
import { Button } from "../../../ui/Button";
import { Modal } from "../../../ui/Dialog";
import { Field } from "../../../ui/forms/Input";
import { Textarea } from "../../../ui/forms/Textarea";
import { attempt } from "../../../state/attempt";
import { useProject } from "../../../state/project/index";

const TEXT_ID = "reference-note-text";

/** "Add note": a title (optional) and some text kept in the book's references; it is never exported. */
export function AddNoteDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useLingui();
  const actions = useProject((s) => s.actions);
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const close = (next: boolean) => {
    onOpenChange(next);
    if (next) return;
    setTitle("");
    setText("");
    setError(null);
  };
  const submit = () =>
    attempt(
      actions.addNote(text, title).then((problem) => {
        if (problem === null) return close(false);
        setError(problem);
        document.getElementById(TEXT_ID)?.focus();
      }),
    );
  return (
    <Modal
      open={open}
      onOpenChange={close}
      title={t`Add note`}
      description={t`Jot something down next to your research.`}
    >
      <form
        noValidate
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <Field
          label={t`Title (optional)`}
          value={title}
          hint={t`Leave empty to use the first line.`}
          onChange={(e) => setTitle(e.target.value)}
        />
        <Textarea
          label={t`Note`}
          id={TEXT_ID}
          rows={6}
          autoFocus
          value={text}
          maxLength={MAX_NOTE_CHARS}
          error={error ?? undefined}
          hint={t`Kept in the book, never exported.`}
          onChange={(e) => {
            setText(e.target.value);
            setError(null);
          }}
        />
        <div className="flex justify-end gap-2.5">
          <Button onClick={() => close(false)}>{t`Cancel`}</Button>
          <Button type="submit" variant="primary">{t`Add note`}</Button>
        </div>
      </form>
    </Modal>
  );
}
