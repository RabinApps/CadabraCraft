import { useMemo } from "react";
import { useLingui } from "@lingui/react/macro";
import type { BookPage } from "../../state/project/types";
import { AnalysisSection } from "./AnalysisSection";
import { AnalysisSummary } from "./AnalysisSummary";
import { analysisView, type Format } from "./analysisModel";
import { reportFor, type Scope } from "./analysisScope";

interface Props {
  pages: BookPage[];
  scope: Scope;
  openId: string | null;
}

/** The report of one scope: a message when there is no text yet, else the summary row and the sections. */
export function AnalysisReport({ pages, scope, openId }: Props) {
  const { t, i18n } = useLingui();
  const fmt = useMemo<Format>(() => {
    const formatter = new Intl.NumberFormat(i18n.locale, { maximumFractionDigits: 1 });
    return (n) => formatter.format(n);
  }, [i18n.locale]);
  const view = useMemo(
    () => analysisView(reportFor(pages, scope, openId), fmt),
    [pages, scope, openId, fmt],
  );
  if (view.blank) {
    return (
      <p className="py-6 text-center text-small text-ink-muted">
        {scope === "book"
          ? t`There is no text in this book yet.`
          : t`There is no text in this chapter yet.`}
      </p>
    );
  }
  return (
    <div className="flex flex-col gap-4">
      <AnalysisSummary tiles={view.tiles} />
      {view.sections.map((section) => (
        <AnalysisSection key={section.key} section={section} fmt={fmt} />
      ))}
    </div>
  );
}
