import { sourceEdition } from "@cadabracraft/format";
import { resolveTrimSize } from "@cadabracraft/templates";
import { useEffect, useState } from "react";
import { useLingui } from "@lingui/react/macro";
import { Save } from "lucide-react";
import { whyText } from "../../lib/projectError";
import {
  publishingProblem,
  publishingToForm,
  type PublishingForm,
  type PublishingProblem,
} from "../../lib/export/publishingForm";
import { Button } from "../../ui/Button";
import { Modal } from "../../ui/Dialog";
import { focusField } from "../../ui/forms/Input";
import { useProject, type BookDetails } from "../../state/project/index";
import {
  CoverColumn,
  firstProblem,
  IdentityFields,
  problemText,
  PublishingFields,
} from "./BookDetailsFields";
import { Notice } from "../../ui/feedback/Notice";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const editionOf = (
  m: NonNullable<ReturnType<typeof useProject.getState>["manifest"]>,
  language: string | null,
) => m.editions.find((e) => e.language === language) ?? sourceEdition(m.editions);

const detailsOf = (
  m: NonNullable<ReturnType<typeof useProject.getState>["manifest"]>,
  language: string | null,
): BookDetails => {
  const e = editionOf(m, language);
  return {
    title: e.title,
    author: e.author,
    language: e.language,
    isbn: e.isbn ?? "",
    identifier: e.identifier,
    cover: e.cover,
    trimSize: resolveTrimSize(m),
    publishing: publishingToForm(e.publishing),
  };
};

/** Edit the book's title, author, language, ISBN, identifier and cover image. Nothing is stored until Save. */
export function BookDetailsDialog({ open, onOpenChange }: Props) {
  const { t } = useLingui();
  const manifest = useProject((s) => s.manifest);
  const updateDetails = useProject((s) => s.actions.updateDetails);
  const importCover = useProject((s) => s.actions.importCover);
  const activeLanguage = useProject((s) => s.activeLanguage);
  const [form, setForm] = useState<BookDetails | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  // Start from the saved values each time the dialog opens.
  useEffect(() => {
    if (open && manifest) {
      setForm(detailsOf(manifest, activeLanguage));
      setError("");
    }
  }, [open]);
  if (!manifest || !form) return null;
  // A translation edition has its own details but keeps its language.
  const isTranslation =
    activeLanguage !== null && activeLanguage !== sourceEdition(manifest.editions).language;
  const set = (patch: Partial<BookDetails>) => setForm({ ...form, ...patch });
  const publishing = form.publishing ?? publishingToForm(undefined);
  const setPublishing = (patch: Partial<PublishingForm>) =>
    set({ publishing: { ...publishing, ...patch } });
  const problem = publishingProblem(publishing);
  const problemFor = (field: PublishingProblem["field"]) =>
    problem?.field === field ? problemText(problem) : undefined;
  const { message: missing, field: badField } = firstProblem(form, problem);

  // The field Save refused, while its message is the one showing (see `save`).
  const flagged = error !== "" && error === missing ? badField : undefined;
  const flagId = (field: string) => (flagged === field ? "details-error" : undefined);

  const choose = async () => {
    setError("");
    const picked = await importCover();
    if (picked) set({ cover: picked });
    else if (useProject.getState().notice) setError(useProject.getState().notice);
  };
  const save = async () => {
    if (missing) {
      setError(missing);
      // A publishing field sits in the collapsed section: open it so the field can take focus.
      if (badField && !["title", "author", "identifier"].includes(badField))
        document.getElementById("details-publishing")?.setAttribute("open", "");
      if (badField) focusField(`details-${badField}`);
      return;
    }
    setBusy(true);
    try {
      await updateDetails(form, activeLanguage ?? undefined);
      onOpenChange(false);
    } catch (e) {
      const why = whyText(e);
      setError(t`The details could not be saved: ${why}. Try again; nothing was changed.`);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      open={open}
      onOpenChange={(o) => {
        if (!busy) onOpenChange(o);
      }}
      title={isTranslation ? t`Book details (${form.language})` : t`Book details`}
      size="wide"
    >
      <form
        className="flex flex-col gap-5 sm:flex-row sm:gap-7"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <CoverColumn
          form={form}
          onChoose={() => void choose()}
          onRemove={() => set({ cover: null })}
        />
        <div className="flex min-w-0 flex-1 flex-col gap-3.5">
          <IdentityFields form={form} isTranslation={isTranslation} flagId={flagId} set={set} />
          <PublishingFields
            publishing={publishing}
            setPublishing={setPublishing}
            problemFor={problemFor}
          />
          {error && (
            <Notice id="details-error" role="alert">
              {error}
            </Notice>
          )}
          <div className="mt-auto flex justify-end gap-2.5 pt-2">
            <Button disabled={busy} onClick={() => onOpenChange(false)}>{t`Cancel`}</Button>
            <Button
              type="submit"
              variant="primary"
              icon={Save}
              disabled={busy}
            >{t`Save details`}</Button>
          </div>
        </div>
      </form>
    </Modal>
  );
}
