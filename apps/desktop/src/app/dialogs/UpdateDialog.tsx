import { useLingui } from "@lingui/react/macro";
import { CircleArrowUp, Download } from "lucide-react";
import { Button } from "../../ui/Button";
import { Modal } from "../../ui/Dialog";
import { useUpdates } from "../../state/updates";

/**
 * Shown when GitHub Releases has a newer version. Nothing installs until the author presses Install now; "Later" waits for
 * the next launch. The download is checked against the app's update signature before it is installed.
 */
export function UpdateDialog() {
  const { t } = useLingui();
  const dialogOpen = useUpdates((s) => s.dialogOpen);
  const status = useUpdates((s) => s.status);
  const { later, install } = useUpdates.getState();
  const update = status.kind === "available" ? status.update : null;
  const installing = status.kind === "installing";
  const error = status.kind === "error" ? status.message : "";
  return (
    <Modal open={dialogOpen} onOpenChange={(o) => { if (!o && !installing) later(); }} title={update ? t`Version ${update.version} is available` : t`Update available`}>
      <div className="flex flex-col gap-4">
        {update && (
          <p className="flex items-center gap-2 rounded-md bg-accent-soft px-3 py-2 text-[13px] font-semibold text-accent">
            <CircleArrowUp size={16} aria-hidden />
            {t`You have ${update.currentVersion}. Your books and settings stay as they are.`}
          </p>
        )}
        <p className="text-sm leading-relaxed">{t`The new version is downloaded from GitHub and checked against a signature before it installs. Installing closes CadabraCraft and reopens it on the new version.`}</p>
        <p className="text-xs leading-relaxed text-ink-muted">{t`The only thing sent is the update check. Nothing about your books is sent.`}</p>
        {error && <p role="alert" className="text-[13px] text-danger">{t`Could not install the update: ${error}`}</p>}
        <div className="flex flex-wrap items-center justify-end gap-2.5">
          <Button disabled={installing} onClick={later}>{t`Later`}</Button>
          <Button variant="primary" icon={Download} disabled={!update || installing} onClick={() => void install()}>
            {installing ? t`Installing…` : t`Install now`}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
