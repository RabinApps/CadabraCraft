import { TRIM_SIZES, type TrimSize } from "@cadabracraft/export-pdf";
import { useEffect, useState } from "react";
import { t as translate } from "@lingui/core/macro";
import { useLingui } from "@lingui/react/macro";
import { ChevronRight, ImagePlus, Image as ImageIcon, Trash2 } from "lucide-react";
import { ENABLED_LOCALE_INFO, LOCALES } from "../../i18n/locales";
import { assetUrl } from "../../lib/assets";
import type { PublishingForm, PublishingProblem } from "../../lib/export/publishingForm";
import { trimLabel } from "../../lib/export/trimLabels";
import { Button, IconButton } from "../../ui/Button";
import { Field } from "../../ui/forms/Input";
import { Textarea } from "../../ui/forms/Textarea";
import { Select } from "../../ui/forms/Select";
import { isbnProblemText, isbnValid } from "../../lib/export/isbnForm";
import { useProject, type BookDetails } from "../../state/project/index";
import { SceneBreakField } from "./SceneBreakField";

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
        className="aspect-2/3 w-full rounded-md border border-border object-cover"
      />
    );
  return (
    <div className="flex aspect-2/3 w-full flex-col items-center justify-center gap-2.5 rounded-md border border-border bg-accent-soft p-4 text-center">
      <ImageIcon size={32} className="text-accent" aria-hidden />
      <p className="font-book text-title font-semibold">{title}</p>
      <p className="font-book text-sm text-ink-muted">{author}</p>
      {failed && (
        <p role="alert" className="text-xs text-danger">{t`The cover image could not be read.`}</p>
      )}
    </div>
  );
}

/** The message under the field that `publishingProblem` found. */
export function problemText(p: PublishingProblem): string {
  if (p.code === "multi-line") return translate`Use a single line.`;
  if (p.code === "too-long")
    return p.field === "subjects"
      ? translate`Each subject can have up to ${p.max} characters.`
      : translate`Use at most ${p.max} characters.`;
  if (p.code === "too-many") return translate`Use at most ${p.max} subjects.`;
  if (p.code === "needs-series") return translate`Enter the series name first.`;
  if (p.code === "bad-number") return translate`Use a number such as 1 or 2.5.`;
  return translate`Enter a real date.`;
}

/** Enabled languages only, plus the book's current one when it is not enabled (so it is not silently changed). */
function languageChoices(current: string) {
  if (ENABLED_LOCALE_INFO.some((l) => l.code === current)) return ENABLED_LOCALE_INFO;
  return [
    ...ENABLED_LOCALE_INFO,
    LOCALES.find((l) => l.code === current) ?? {
      code: current,
      nativeName: current,
      dir: "ltr" as const,
    },
  ];
}

/** The first thing wrong with the form: the message to show and the field it belongs to. */
export function firstProblem(
  form: BookDetails,
  problem: PublishingProblem | null,
): { message: string; field: string | undefined } {
  if (!form.title.trim()) return { message: translate`Give the book a title.`, field: "title" };
  if (!form.author.trim()) return { message: translate`Give the book an author.`, field: "author" };
  if (!form.identifier.trim()) {
    return { message: translate`The identifier cannot be empty.`, field: "identifier" };
  }
  if (!isbnValid(form.isbn)) return { message: isbnProblemText(), field: "isbn" };
  if (problem) return { message: problemText(problem), field: problem.field };
  return { message: "", field: undefined };
}

/** The left column: cover preview, the buttons to pick or remove it, and the format hint. */
export function CoverColumn({
  form,
  onChoose,
  onRemove,
}: {
  form: BookDetails;
  onChoose: () => void;
  onRemove: () => void;
}) {
  const { t } = useLingui();
  return (
    <div className="flex w-full flex-col gap-2.5 sm:w-50 sm:shrink-0">
      <span className="text-xs font-semibold text-ink-muted">{t`Cover`}</span>
      <div className="mx-auto w-40 sm:w-full">
        <CoverPreview cover={form.cover} title={form.title} author={form.author} />
      </div>
      <div className="flex gap-2">
        <Button
          className="flex-1 gap-1.5 whitespace-nowrap px-2"
          icon={ImagePlus}
          onClick={onChoose}
        >{t`Choose image…`}</Button>
        <IconButton
          icon={Trash2}
          label={t`Remove cover`}
          disabled={!form.cover}
          onClick={onRemove}
        />
      </div>
      <p className="text-xs leading-relaxed text-ink-muted">{t`PNG, JPEG or WebP, up to 25 MB. A copy is kept in the book's assets folder. Portrait, about 1600 × 2400 px, works best.`}</p>
    </div>
  );
}

/** Title, author, language, ISBN, trim size and identifier. */
export function IdentityFields({
  form,
  isTranslation,
  flagId,
  set,
}: {
  form: BookDetails;
  isTranslation: boolean;
  flagId: (field: string) => string | undefined;
  set: (patch: Partial<BookDetails>) => void;
}) {
  const { t } = useLingui();
  const languages = languageChoices(form.language);
  // The ISBN message appears after the field loses focus, then follows each change until it is valid.
  const [isbnChecked, setIsbnChecked] = useState(false);
  return (
    <>
      <Field
        label={t`Title`}
        id="details-title"
        errorId={flagId("title")}
        value={form.title}
        onChange={(e) => set({ title: e.target.value })}
      />
      <Field
        label={t`Author`}
        id="details-author"
        errorId={flagId("author")}
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
            id="details-isbn"
            value={form.isbn}
            error={isbnChecked && !isbnValid(form.isbn) ? isbnProblemText() : undefined}
            onChange={(e) => set({ isbn: e.target.value })}
            onBlur={() => setIsbnChecked(true)}
            hint={t`ISBN-10 or ISBN-13. Hyphens and spaces are removed when you save.`}
          />
        </div>
      </div>
      <Select
        label={t`Trim size`}
        value={form.trimSize}
        onChange={(e) => set({ trimSize: e.target.value as TrimSize })}
        hint={t`The page size of the print PDF. Changing it reflows the book and changes the page count; your text is not touched.`}
      >
        {(Object.keys(TRIM_SIZES) as TrimSize[]).map((id) => (
          <option key={id} value={id}>
            {trimLabel(id)}
          </option>
        ))}
      </Select>
      <SceneBreakField
        value={form.sceneBreak ?? null}
        onChange={(sceneBreak) => set({ sceneBreak })}
      />
      <Field
        label={t`Identifier`}
        id="details-identifier"
        errorId={flagId("identifier")}
        value={form.identifier}
        onChange={(e) => set({ identifier: e.target.value })}
        hint={t`Unique id stored in the EPUB. Change it only if a store or library asked you to.`}
      />
    </>
  );
}

/** The collapsed "Publishing details" section. */
export function PublishingFields({
  publishing,
  setPublishing,
  problemFor,
}: {
  publishing: PublishingForm;
  setPublishing: (patch: Partial<PublishingForm>) => void;
  problemFor: (field: PublishingProblem["field"]) => string | undefined;
}) {
  const { t } = useLingui();
  return (
    <details id="details-publishing" className="group rounded-md border border-border">
      <summary className="flex cursor-pointer list-none items-center gap-1.5 px-3 py-2.5 text-sm max-md:min-h-11 font-semibold text-ink focus-visible:outline-2 focus-visible:outline-accent">
        <ChevronRight
          size={16}
          aria-hidden
          className="transition-transform group-open:rotate-90 rtl:-scale-x-100 rtl:group-open:-rotate-90"
        />
        {t`Publishing details`}
      </summary>
      <div className="flex flex-col gap-3.5 border-t border-border p-3">
        <p className="text-xs leading-relaxed text-ink-muted">{t`Stored in the EPUB for stores and libraries. Everything here is optional.`}</p>
        <Field
          label={t`Publisher`}
          id="details-publisher"
          value={publishing.publisher}
          error={problemFor("publisher")}
          onChange={(e) => setPublishing({ publisher: e.target.value })}
        />
        <div className="flex gap-3 max-sm:flex-col">
          <div className="min-w-0 flex-1">
            <Field
              label={t`Series`}
              id="details-series"
              value={publishing.series}
              error={problemFor("series")}
              onChange={(e) => setPublishing({ series: e.target.value })}
            />
          </div>
          <div className="sm:w-28">
            <Field
              label={t`Number in series`}
              id="details-seriesNumber"
              inputMode="decimal"
              value={publishing.seriesNumber}
              error={problemFor("seriesNumber")}
              onChange={(e) => setPublishing({ seriesNumber: e.target.value })}
            />
          </div>
        </div>
        <Field
          label={t`Publication date`}
          id="details-published"
          type="date"
          value={publishing.published}
          error={problemFor("published")}
          onChange={(e) => setPublishing({ published: e.target.value })}
        />
        <Textarea
          label={t`Subjects`}
          id="details-subjects"
          rows={3}
          value={publishing.subjects}
          error={problemFor("subjects")}
          onChange={(e) => setPublishing({ subjects: e.target.value })}
          hint={t`One per line: BISAC codes such as FIC014000, or keywords.`}
        />
        <Textarea
          label={t`Description`}
          id="details-description"
          rows={4}
          value={publishing.description}
          error={problemFor("description")}
          onChange={(e) => setPublishing({ description: e.target.value })}
          hint={t`The blurb shown in stores. Plain text.`}
        />
        <Field
          label={t`Rights`}
          id="details-rights"
          value={publishing.rights}
          error={problemFor("rights")}
          onChange={(e) => setPublishing({ rights: e.target.value })}
          hint={t`For example: © 2026 A. Writer. All rights reserved.`}
        />
      </div>
    </details>
  );
}
