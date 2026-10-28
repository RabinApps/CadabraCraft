import { sourceEdition } from "@cadabracraft/format";
import { useEffect, useState } from "react";
import { useLingui } from "@lingui/react/macro";
import { ImagePlus, Image as ImageIcon, Save, Trash2 } from "lucide-react";
import { LOCALES } from "../../i18n/locales";
import { assetUrl } from "../../lib/assets";
import { errText } from "../../lib/projectError";
import { Button, IconButton } from "../../ui/Button";
import { Modal } from "../../ui/Dialog";
import { Field } from "../../ui/Input";
import { Select } from "../../ui/Select";
import { useProject, type BookDetails } from "../../state/project/index";
import { Notice } from "../../ui/Notice";

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
  };
};

/** Cover preview: the picked image, or a placeholder showing the title and author as they would sit on the cover. */
function CoverPreview({
  cover,
  title,
  author,
}: {
  cover: string | null;
  title: string;
  author: string;
}) {
  const { t } = useLingui();
  const root = useProject((s) => s.root);
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    setUrl(null);
    setFailed(false);
    if (!cover || !root) return;
    let live = true;
    assetUrl(root, cover).then(
      (u) => {
        if (live) setUrl(u);
      },
      () => {
        if (live) setFailed(true);
      },
    );
    return () => {
      live = false;
    };
  }, [root, cover]);
  if (url)
    return (
      <img
        src={url}
        alt={t`Cover preview`}
        className="aspect-[2/3] w-full rounded-md border border-border object-cover"
      />
    );
  return (
    <div className="flex aspect-[2/3] w-full flex-col items-center justify-center gap-2.5 rounded-md border border-border bg-accent-soft p-4 text-center">
      <ImageIcon size={32} className="text-accent" aria-hidden />
      <p className="font-book text-title font-semibold">{title}</p>
      <p className="font-book text-sm text-ink-muted">{author}</p>
      {failed && (
        <p role="alert" className="text-xs text-danger">{t`The cover image could not be read.`}</p>
      )}
    </div>
  );
}

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
  const languages = LOCALES.some((l) => l.code === form.language)
    ? LOCALES
    : [...LOCALES, { code: form.language, nativeName: form.language, dir: "ltr" as const }];
  const missing = !form.title.trim()
    ? t`Give the book a title.`
    : !form.author.trim()
      ? t`Give the book an author.`
      : !form.identifier.trim()
        ? t`The identifier cannot be empty.`
        : "";

  const choose = async () => {
    setError("");
    const picked = await importCover();
    if (picked) set({ cover: picked });
    else if (useProject.getState().notice) setError(useProject.getState().notice);
  };
  const save = async () => {
    if (missing) {
      setError(missing);
      return;
    }
    setBusy(true);
    try {
      await updateDetails(form, activeLanguage ?? undefined);
      onOpenChange(false);
    } catch (e) {
      setError(errText(e));
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
        <div className="flex w-full flex-col gap-2.5 sm:w-[200px] sm:shrink-0">
          <span className="text-xs font-semibold text-ink-muted">{t`Cover`}</span>
          <div className="mx-auto w-[160px] sm:w-full">
            <CoverPreview cover={form.cover} title={form.title} author={form.author} />
          </div>
          <div className="flex gap-2">
            <Button
              className="flex-1 gap-1.5 whitespace-nowrap px-2"
              icon={ImagePlus}
              onClick={() => void choose()}
            >{t`Choose image…`}</Button>
            <IconButton
              icon={Trash2}
              label={t`Remove cover`}
              disabled={!form.cover}
              onClick={() => set({ cover: null })}
            />
          </div>
          <p className="text-xs leading-relaxed text-ink-muted">{t`PNG, JPEG or WebP, up to 25 MB. A copy is kept in the book's assets folder. Portrait, about 1600 × 2400 px, works best.`}</p>
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-3.5">
          <Field
            label={t`Title`}
            value={form.title}
            onChange={(e) => set({ title: e.target.value })}
          />
          <Field
            label={t`Author`}
            value={form.author}
            onChange={(e) => set({ author: e.target.value })}
          />
          <div className="flex gap-3 max-sm:flex-col">
            <div className="min-w-0 flex-1">
              <Select
                label={t`Language`}
                value={form.language}
                disabled={isTranslation}
                onChange={(e) => set({ language: e.target.value })}
              >
                {languages.map((l) => (
                  <option key={l.code} value={l.code}>{`${l.nativeName} (${l.code})`}</option>
                ))}
              </Select>
            </div>
            <div className="min-w-0 flex-1">
              <Field
                label={t`ISBN`}
                value={form.isbn}
                onChange={(e) => set({ isbn: e.target.value })}
              />
            </div>
          </div>
          <Field
            label={t`Identifier`}
            value={form.identifier}
            onChange={(e) => set({ identifier: e.target.value })}
            hint={t`Unique id stored in the EPUB. Change it only if a store or library asked you to.`}
          />
          {error && <Notice role="alert">{error}</Notice>}
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
