import { useState } from "react";
import { useLingui } from "@lingui/react/macro";
import { Button } from "../../../ui/Button";
import { Modal } from "../../../ui/Dialog";
import { Field, focusField } from "../../../ui/forms/Input";
import { attempt } from "../../../state/attempt";
import { useProject } from "../../../state/project/index";

const ADDRESS_ID = "reference-link-address";

/** "Add link": an http or https address and an optional title. Nothing is fetched from the address. */
export function AddLinkDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useLingui();
  const actions = useProject((s) => s.actions);
  const [url, setUrl] = useState("");
  const [title, setTitle] = useState("");
  const [error, setError] = useState<string | null>(null);
  /** Closing by any route (Cancel, Escape, a saved link) clears the form, so the next time starts empty. */
  const close = (next: boolean) => {
    onOpenChange(next);
    if (next) return;
    setUrl("");
    setTitle("");
    setError(null);
  };
  const submit = () =>
    attempt(
      actions.addLink(url, title).then((problem) => {
        if (problem === null) return close(false);
        setError(problem);
        focusField(ADDRESS_ID);
      }),
    );
  return (
    <Modal
      open={open}
      onOpenChange={close}
      title={t`Add link`}
      description={t`Keep a web page with your research. It opens in your browser when you choose Open.`}
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
          label={t`Address`}
          id={ADDRESS_ID}
          type="url"
          inputMode="url"
          autoFocus
          value={url}
          placeholder="https://"
          error={error ?? undefined}
          hint={t`Use http or https. The link opens in your browser; nothing is fetched.`}
          onChange={(e) => {
            setUrl(e.target.value);
            setError(null);
          }}
        />
        <Field
          label={t`Title (optional)`}
          value={title}
          hint={t`Shown in the list. Leave empty to use the address.`}
          onChange={(e) => setTitle(e.target.value)}
        />
        <div className="flex justify-end gap-2.5">
          <Button onClick={() => close(false)}>{t`Cancel`}</Button>
          <Button type="submit" variant="primary">{t`Add link`}</Button>
        </div>
      </form>
    </Modal>
  );
}
