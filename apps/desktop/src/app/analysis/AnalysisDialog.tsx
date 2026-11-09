import { useState } from "react";
import { useLingui } from "@lingui/react/macro";
import { Modal } from "../../ui/Dialog";
import { useAnalysis } from "../../state/app/analysis";
import { AnalysisReport } from "./AnalysisReport";
import { AnalysisTabs } from "./AnalysisTabs";
import type { Scope } from "./analysisScope";
import { useAnalysisPages } from "./useAnalysisPages";

/**
 * File > Analysis…: a local report of the book's style and readability. Counts only; the text is read on this computer and
 * nothing is sent or saved.
 */
export function AnalysisDialog() {
  const { t } = useLingui();
  const open = useAnalysis((s) => s.open);
  const { pages, error, openId } = useAnalysisPages(open);
  const [scope, setScope] = useState<Scope>("book");
  return (
    <Modal
      open={open}
      onOpenChange={(o) => {
        if (!o) useAnalysis.getState().close();
      }}
      title={t`Analysis`}
      description={t`Counts from the text, worked out on this computer. Nothing is sent anywhere, and nothing is changed in your book.`}
      size="xl"
    >
      <div className="flex flex-col gap-4">
        <AnalysisTabs value={scope} onChange={setScope} />
        <div role="tabpanel" id="analysis-panel" aria-labelledby={`analysis-tab-${scope}`}>
          {error ? (
            <p role="alert" className="text-small text-danger">
              {t`Could not read the book for the report: ${error}.`}
            </p>
          ) : pages === null ? (
            <p className="py-6 text-center text-small text-ink-muted">{t`Counting…`}</p>
          ) : (
            <AnalysisReport pages={pages} scope={scope} openId={openId} />
          )}
        </div>
      </div>
    </Modal>
  );
}
