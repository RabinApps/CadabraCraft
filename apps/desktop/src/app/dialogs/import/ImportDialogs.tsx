import { useRef, useState } from "react";
import { useLingui } from "@lingui/react/macro";
import { Modal } from "../../../ui/Dialog";
import { loadImport, type ImportChoices } from "../../../lib/import/importBook";
import { causeText } from "../../../lib/projectError";
import { useProject } from "../../../state/project/index";
import { previewChoices } from "../../../lib/import/importDestination";
import { AT_END, ImportDestination } from "./ImportDestination";
import { useImportPicker } from "./useImportPicker";
import {
  PickStep,
  PreviewStep,
  useImportFeedback,
  useImportFields,
  useImportPreview,
} from "./ImportSteps";

export { ImportReportDialog } from "./ImportReportDialog";

interface ImportProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  pickSource: () => Promise<string | null>;
  pickFolder: () => Promise<string | null>;
  onImport: (
    source: string,
    root: string,
    title: string,
    author: string,
    opts?: ImportChoices,
  ) => Promise<void>;
  /** When set, the dialog adds the chosen chapters to the open book instead of creating one: no title, author or folder. */
  onImportInto?: (source: string, opts?: ImportChoices) => Promise<void>;
}

/** Two steps: pick a source and destination, then preview how it splits into chapters. Only the last button writes; the source is only read. */
export function ImportDialog({
  open,
  onOpenChange,
  pickSource,
  pickFolder,
  onImport,
  onImportInto,
}: ImportProps) {
  const append = onImportInto !== undefined;
  const { t } = useLingui();
  const fields = useImportFields();
  const feedback = useImportFeedback();
  const [busy, setBusy] = useState(false);
  const state = useImportPreview(feedback, busy, setBusy);
  const manifest = useProject((s) => s.manifest);
  const [after, setAfter] = useState(AT_END);
  const { preview, setPreview } = state;
  const { source, root, title, author } = fields;
  const { error, fail } = feedback;
  const gen = useRef(0);
  const change = (o: boolean) => {
    if (busy) return;
    if (!o) {
      gen.current++;
      fields.reset();
      setAfter(AT_END);
      setPreview(null);
      feedback.clear();
    }
    onOpenChange(o);
  };
  const pick = useImportPicker({ gen, busy, feedback, pickSource, pickFolder });
  const next = () => {
    if (busy) return;
    // The button is not dead: pressing it says what is missing and puts the cursor there.
    if (!source) return fail(t`No file is chosen. Choose the file to import.`, "file");
    if (!append && !title.trim()) return fail(t`The book has no title. Type one.`, "title");
    if (!append && !root)
      return fail(t`No folder is chosen. Choose an empty folder for the new book.`, "folder");
    setBusy(true);
    feedback.clear();
    loadImport(source)
      .then((l) => state.parse(l, 1, false))
      .catch((e) =>
        fail(
          t`Could not read this file (${causeText(e)}). Choose a different file (Word .docx, Markdown or HTML) and try again.`,
          "file",
        ),
      )
      .finally(() => setBusy(false));
  };
  const submit = () => {
    if (!source || busy || (!append && !root)) return;
    setBusy(true);
    feedback.setError("");
    const choices = previewChoices(
      preview,
      append ? manifest : null,
      after === AT_END ? null : after,
    );
    (onImportInto
      ? onImportInto(source, choices)
      : onImport(source, root!, title.trim(), author.trim() || t`Unknown`, choices)
    )
      .then(() => {
        setBusy(false);
        change(false);
      })
      .catch((err) => {
        setBusy(false);
        fail(
          t`Could not import (${causeText(err)}). Your original file was not changed. Try again, or go back and choose a different file.`,
        );
      });
  };
  return (
    <Modal
      open={open}
      onOpenChange={change}
      title={append ? t`Import into this book` : t`Import a manuscript`}
      description={
        append
          ? t`Adds the chapters of a Word (.docx), Markdown or HTML file to this book, where you choose. Existing chapters are not changed, and neither is the original file.`
          : t`Creates a new book from a Word (.docx), Markdown or HTML file. The original file is never changed.`
      }
    >
      {preview ? (
        <PreviewStep
          preview={preview}
          state={state}
          append={append}
          busy={busy}
          error={error}
          destination={
            append && (
              <ImportDestination
                manifest={manifest}
                value={after}
                disabled={busy}
                onChange={setAfter}
              />
            )
          }
          onBack={state.back}
          onSubmit={submit}
        />
      ) : (
        <PickStep
          append={append}
          busy={busy}
          fields={fields}
          feedback={feedback}
          onPick={pick}
          onNext={next}
          onCancel={() => change(false)}
        />
      )}
    </Modal>
  );
}
