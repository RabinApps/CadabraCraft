import { sourceEdition } from "@cadabracraft/format";
import { useLingui } from "@lingui/react/macro";
import { plural } from "@lingui/core/macro";
import type { Manifest } from "@cadabracraft/format";
import { getTemplate, hasTemplate, DEFAULT_TEMPLATE_ID } from "@cadabracraft/templates";
import { Pencil } from "lucide-react";
import { readingMinutes } from "../../lib/readingTime";
import { Button } from "../../ui/Button";
import { useProject } from "../../state/project";
import { SectionHeading } from "../../ui/SectionHeading";

interface Props {
  manifest: Manifest;
  /** Title of the open page, if any. */
  pageTitle: string | null;
  section: "front" | "chapter" | "back" | null;
  words: number;
  /** Opens the Templates page. */
  onChangeTemplate: () => void;
  /** Opens the Book details dialog. */
  onEditDetails: () => void;
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1.5 text-sm">
      <dt className="text-ink-muted">{label}</dt>
      <dd className="min-w-0 truncate text-end font-medium" title={value}>
        {value}
      </dd>
    </div>
  );
}

/** Read-only facts from the manifest and the open page; nothing here is stored. */
export function Details({
  manifest,
  pageTitle,
  section,
  words,
  onChangeTemplate,
  onEditDetails,
}: Props) {
  const { t } = useLingui();
  const minutes = readingMinutes(words);
  const activeLanguage = useProject((s) => s.activeLanguage);
  const edition =
    manifest.editions.find((e) => e.language === activeLanguage) ??
    sourceEdition(manifest.editions);
  const sectionLabel =
    section === "front" ? t`Front matter` : section === "back" ? t`Back matter` : t`Chapter`;
  return (
    <div className="flex flex-col gap-6 p-4">
      <section aria-labelledby="details-page">
        <SectionHeading id="details-page">{t`This page`}</SectionHeading>
        <dl>
          <Row label={t`Title`} value={pageTitle ?? "-"} />
          <Row label={t`Section`} value={section ? sectionLabel : "-"} />
          <Row label={t`Words`} value={String(words)} />
          <Row
            label={t`Reading time`}
            value={plural(minutes, { one: "# minute", other: "# minutes" })}
          />
        </dl>
      </section>
      <section aria-labelledby="details-book">
        <SectionHeading id="details-book">{t`Book`}</SectionHeading>
        <dl>
          <Row label={t`Title`} value={edition.title} />
          <Row label={t`Author`} value={edition.author || "-"} />
          <Row label={t`Language`} value={edition.language} />
          <Row
            label={t`Template`}
            value={
              getTemplate(hasTemplate(manifest.template) ? manifest.template : DEFAULT_TEMPLATE_ID)
                .name
            }
          />
          <Row label={t`ISBN`} value={edition.isbn ?? "-"} />
          <Row label={t`Cover`} value={edition.cover?.replace("assets/", "") ?? "-"} />
          <Row label={t`Chapters`} value={String(manifest.chapters.length)} />
        </dl>
        <Button
          className="mt-3 w-full"
          icon={Pencil}
          onClick={onEditDetails}
        >{t`Edit details`}</Button>
        <Button className="mt-2 w-full" onClick={onChangeTemplate}>{t`Change template`}</Button>
      </section>
    </div>
  );
}
