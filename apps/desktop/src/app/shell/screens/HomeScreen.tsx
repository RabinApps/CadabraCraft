import type { ReactNode } from "react";
import { bridge } from "../../../lib/bridge";
import { errText } from "../../../lib/projectError";
import { useProject } from "../../../state/project/index";
import { Home } from "../../home/Home";
import { ImportReportDialog } from "../../dialogs/LazyImportDialogs";
import { SponsorDialog } from "../../dialogs/SponsorDialog";
import { UpdateDialog } from "../../dialogs/UpdateDialog";
import { LicensesDialog } from "../../dialogs/LicensesDialog";

/** Home, shown while no book is open. It stays mounted (hidden) under the opening skeleton, so a failed open still marks its row. */
export function HomeScreen({
  skeleton,
  error,
  setError,
  run,
  onSettings,
}: {
  skeleton: ReactNode;
  error: string;
  setError: (message: string) => void;
  run: (f: () => Promise<void>) => () => void;
  onSettings: () => void;
}) {
  const actions = useProject((s) => s.actions);
  return (
    <>
      {skeleton}
      <div className="contents" hidden={skeleton !== null}>
        <Home
          error={error}
          onSettings={onSettings}
          pickFolder={bridge.pickFolder}
          pickImportSource={bridge.pickImportSource}
          onImport={actions.importBook}
          onCreate={(root, title, author, trimSize) =>
            run(() => actions.createProject(root, title, author, trimSize))()
          }
          onOpenRecent={(r) => {
            setError("");
            return actions.openProject(r).catch((e) => {
              setError(errText(e));
              throw e;
            });
          }}
          onOpen={run(async () => {
            const root = await bridge.pickFolder();
            if (root) await actions.openProject(root);
          })}
        />
      </div>
      <ImportReportDialog />
      <SponsorDialog />
      <UpdateDialog />
      <LicensesDialog />
    </>
  );
}
