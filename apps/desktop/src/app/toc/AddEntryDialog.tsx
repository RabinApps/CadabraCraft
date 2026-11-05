import { useState } from "react";
import { useLingui } from "@lingui/react/macro";
import type { TocItem } from "@cadabracraft/format";
import { Button } from "../../ui/Button";
import { Modal } from "../../ui/Dialog";
import { Field, focusField } from "../../ui/Input";
import { Notice } from "../../ui/Notice";
import { Select } from "../../ui/Select";

const TITLE_ID = "toc-entry-title";
const ERROR_ID = "toc-entry-error";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The list as shown: entries to place the new one after and to point it at. */
  items: TocItem[];
  onAdd: (init: { title: string; after: string; target?: string }) => Promise<string | null>;
}

/** "Add custom entry": a title, where it goes in the list and which page it points at (its page number comes from there). */
export function AddEntryDialog({ open, onOpenChange, items, onAdd }: Props) {
  const { t } = useLingui();
  const [title, setTitle] = useState("");
  const [after, setAfter] = useState("");
  const [target, setTarget] = useState("");
  const [error, setError] = useState<string | null>(null);
  const last = items.at(-1)?.key ?? "";
  const label = (i: TocItem) => `${"  ".repeat(i.indent ?? i.level)}${i.title}`;
  /** Closing by any route (Cancel, Escape, a new entry) clears the form, so the next time starts empty. */
  const close = (next: boolean) => {
    onOpenChange(next);
    if (next) return;
    setTitle("");
    setTarget("");
    setAfter("");
    setError(null);
  };
  const submit = () => {
    const text = title.trim();
    if (!text) {
      setError(t`The entry has no title.`);
      focusField(TITLE_ID);
      return;
    }
    close(false);
    void onAdd({ title: text, after: after || last, ...(target ? { target } : {}) });
  };
  return (
    <Modal
      open={open}
      onOpenChange={close}
      title={t`Add custom entry`}
      description={t`An entry of your own, such as “Acknowledgments” or a part title. It takes its page number from the entry it points at.`}
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
          label={t`Entry title`}
          value={title}
          autoFocus
          id={TITLE_ID}
          errorId={error ? ERROR_ID : undefined}
          hint={t`Type the name that should appear in the contents.`}
          onChange={(e) => {
            setTitle(e.target.value);
            setError(null);
          }}
        />
        <Select
          label={t`Place after`}
          value={after || last}
          onChange={(e) => setAfter(e.target.value)}
        >
          {items.map((i) => (
            <option key={i.key} value={i.key}>
              {label(i)}
            </option>
          ))}
        </Select>
        <Select
          label={t`Points to`}
          value={target}
          onChange={(e) => setTarget(e.target.value)}
          hint={t`Its page number is shown. Choose “Nothing” for an entry without a number.`}
        >
          <option value="">{t`Nothing`}</option>
          {items
            .filter((i) => i.kind !== "custom")
            .map((i) => (
              <option key={i.key} value={i.key}>
                {label(i)}
              </option>
            ))}
        </Select>
        {error && (
          <Notice id={ERROR_ID} role="alert">
            {error}
          </Notice>
        )}
        <div className="flex justify-end gap-2.5">
          <Button onClick={() => close(false)}>{t`Cancel`}</Button>
          <Button type="submit" variant="primary">
            {t`Add entry`}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
