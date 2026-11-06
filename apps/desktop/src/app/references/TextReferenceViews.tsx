import { useState } from "react";
import { useLingui } from "@lingui/react/macro";
import { Copy, ExternalLink } from "lucide-react";
import type { LinkReference, NoteReference } from "@cadabracraft/format";
import { MAX_NOTE_CHARS } from "@cadabracraft/format";
import { bridge } from "../../lib/bridge";
import { errText } from "../../lib/projectError";
import { attempt } from "../../state/attempt";
import { useProject } from "../../state/project/index";
import { Button } from "../../ui/Button";
import { Field } from "../../ui/forms/Input";
import { Notice } from "../../ui/feedback/Notice";
import { Textarea } from "../../ui/forms/Textarea";

/** Opens a link in the default browser; `onError` gets the reason when the backend refuses. */
export const openLink = (url: string, onError: (message: string) => void): void =>
  void bridge.openReferenceUrl(url).catch((e) => onError(errText(e)));

/** The viewer body of a link: its address (editable), and buttons to open it in the browser or copy it. Nothing is fetched. */
export function LinkView({ reference }: { reference: LinkReference }) {
  const { t } = useLingui();
  const actions = useProject((s) => s.actions);
  const [url, setUrl] = useState(reference.url);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const save = async () => {
    if (url === reference.url) return;
    const problem = await actions.updateLink(reference.id, url);
    if (problem) {
      setError(problem);
      return;
    }
    setError("");
  };
  return (
    <div className="flex flex-1 flex-col gap-4 p-5">
      <Field
        label={t`Address`}
        type="url"
        value={url}
        error={error || undefined}
        hint={t`Only http and https addresses. Nothing is fetched from it.`}
        onChange={(e) => {
          setUrl(e.target.value);
          setError("");
        }}
        onBlur={() => attempt(save())}
      />
      <div className="flex flex-wrap gap-2">
        <Button
          variant="primary"
          icon={ExternalLink}
          onClick={() => openLink(reference.url, setError)}
        >{t`Open in browser`}</Button>
        <Button
          icon={Copy}
          onClick={() =>
            void navigator.clipboard.writeText(reference.url).then(
              () => setCopied(true),
              () => setError(t`Could not copy the address.`),
            )
          }
        >{t`Copy address`}</Button>
      </div>
      {copied && <Notice role="status" tone="success">{t`Address copied.`}</Notice>}
    </div>
  );
}

/** The viewer body of a note: its text, saved when the field loses focus. */
export function NoteView({ reference }: { reference: NoteReference }) {
  const { t } = useLingui();
  const actions = useProject((s) => s.actions);
  const [text, setText] = useState(reference.text);
  return (
    <div className="flex min-h-0 flex-1 flex-col p-5">
      <Textarea
        label={t`Note`}
        value={text}
        maxLength={MAX_NOTE_CHARS}
        rows={12}
        className="min-h-64 font-book text-reading"
        hint={t`Kept in the book, never exported.`}
        onChange={(e) => setText(e.target.value)}
        onBlur={() =>
          text !== reference.text &&
          text.trim() !== "" &&
          attempt(actions.updateReference(reference.id, { text }))
        }
      />
    </div>
  );
}
