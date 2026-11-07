import { useLingui } from "@lingui/react/macro";
import {
  BOOK_SNAPSHOT_KEEP_MAX,
  BOOK_SNAPSHOT_KEEP_MIN,
  BOOK_SNAPSHOT_MAX_MB_MAX,
  BOOK_SNAPSHOT_MAX_MB_MIN,
  cleanBookSnapshotKeep,
  cleanBookSnapshotMaxMb,
  useSettings,
} from "../../state/view/editorPrefs";
import { KeepField, Row, Section } from "./SettingsParts";

/** Settings > Backups: how many snapshots are kept, for chapters and for the whole book, and where they live. */
export function BackupsSection({ title }: { title: string }) {
  const { t } = useLingui();
  const { snapshotKeep, bookSnapshotKeep, bookSnapshotMaxMb, set } = useSettings();
  return (
    <Section id="backups" title={title}>
      <Row
        title={t`Snapshots to keep per chapter`}
        hint={t`Older snapshots are removed, but anything from the last 30 days stays.`}
        control={
          <div className="w-32 max-sm:w-full">
            <KeepField
              key={snapshotKeep}
              label={t`Snapshots to keep per chapter`}
              value={snapshotKeep}
              onCommit={(n) => set({ snapshotKeep: n })}
            />
          </div>
        }
      />
      <Row
        title={t`Book snapshots to keep`}
        hint={t`When there are more, the oldest automatic ones move to .cadabra/trash first; named ones are removed last, and pinned ones stay.`}
        control={
          <div className="w-32 max-sm:w-full">
            <KeepField
              key={bookSnapshotKeep}
              label={t`Book snapshots to keep`}
              value={bookSnapshotKeep}
              min={BOOK_SNAPSHOT_KEEP_MIN}
              max={BOOK_SNAPSHOT_KEEP_MAX}
              clean={cleanBookSnapshotKeep}
              onCommit={(n) => set({ bookSnapshotKeep: n })}
            />
          </div>
        }
      />
      <Row
        title={t`Size limit for book snapshots (MB)`}
        hint={t`All book snapshots together stay under this size. Older ones move to .cadabra/trash, nothing is deleted.`}
        control={
          <div className="w-32 max-sm:w-full">
            <KeepField
              key={bookSnapshotMaxMb}
              label={t`Size limit for book snapshots (MB)`}
              value={bookSnapshotMaxMb}
              min={BOOK_SNAPSHOT_MAX_MB_MIN}
              max={BOOK_SNAPSHOT_MAX_MB_MAX}
              step={100}
              clean={cleanBookSnapshotMaxMb}
              onCommit={(n) => set({ bookSnapshotMaxMb: n })}
            />
          </div>
        }
      />
      <Row
        title={t`When snapshots are taken`}
        hint={t`Before a save replaces different text, at most once every 10 minutes per chapter.`}
        control={null}
      />
      <Row
        title={t`Where they are stored`}
        hint={t`In the .cadabra/backups folder inside your book folder.`}
        control={null}
      />
    </Section>
  );
}
