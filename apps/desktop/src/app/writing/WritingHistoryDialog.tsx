import { useLingui } from "@lingui/react/macro";
import { heatmapGrid, summarizeWriting, writingRecords } from "@cadabracraft/shared";
import { Modal } from "../../ui/Dialog";
import { localDateKey } from "../../lib/writing/statsFile";
import { useWritingDialog } from "../../state/app/writingDialog";
import { WritingHeatmap } from "./WritingHeatmap";
import { WritingStats } from "./WritingStats";
import { useWritingStats } from "./useWritingStats";

/**
 * File > Writing history…: the words the book gained each day, from the saves on this computer (stats.json in the project).
 * Read-only: nothing here changes the book.
 */
export function WritingHistoryDialog() {
  const { t } = useLingui();
  const open = useWritingDialog((s) => s.open);
  const { file, backup, error } = useWritingStats(open);
  const today = localDateKey(new Date());
  return (
    <Modal
      open={open}
      onOpenChange={(o) => {
        if (!o) useWritingDialog.getState().close();
      }}
      title={t`History`}
      description={t`Words written, by day. Counted at each save and kept in this book's folder, on this computer.`}
      size="wide"
    >
      <div className="flex flex-col gap-4">
        {backup && (
          <p role="status" className="text-small text-ink-muted">
            {t`The writing history could not be read; the old copy was kept as ${backup}.`}
          </p>
        )}
        {error ? (
          <p role="alert" className="text-small text-danger">
            {t`Could not read the writing history: ${error}.`}
          </p>
        ) : file === null ? (
          <p className="py-6 text-center text-small text-ink-muted">{t`Loading…`}</p>
        ) : (
          <>
            <WritingStats summary={summarizeWriting(writingRecords(file), today)} />
            <WritingHeatmap weeks={heatmapGrid(writingRecords(file), today)} />
          </>
        )}
      </div>
    </Modal>
  );
}
