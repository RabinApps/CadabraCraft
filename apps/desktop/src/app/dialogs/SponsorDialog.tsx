import { useLingui } from "@lingui/react/macro";
import { CircleCheck, Heart } from "lucide-react";
import { bridge } from "../../lib/bridge";
import { whyText } from "../../lib/projectError";
import { alertOf } from "../../state/project/util";
import { Button } from "../../ui/Button";
import { Modal } from "../../ui/Dialog";
import { SPONSOR_URL, useSponsor } from "../../state/sponsor";
import { useProject } from "../../state/project/index";
import { Notice } from "../../ui/Notice";

/**
 * Shown after a successful export: a short thank-you with a link to sponsor the project. "Maybe later" stays quiet for the
 * session, "Don't show again" for good, and closing it any other way asks again after the next export. Nothing is sent
 * anywhere unless the author presses Sponsor, which opens the page in their browser.
 */
export function SponsorDialog() {
  const { t } = useLingui();
  const exported = useSponsor((s) => s.exported);
  const { snooze, never, close } = useSponsor.getState();
  const sponsor = async () => {
    close();
    try {
      await bridge.openUrl(SPONSOR_URL);
    } catch (e) {
      const why = whyText(e);
      useProject.setState(
        alertOf(
          t`Could not open ${SPONSOR_URL}: ${why}. Copy the address into your browser instead.`,
        ),
      );
    }
  };
  return (
    <Modal
      open={exported !== null}
      onOpenChange={(o) => {
        if (!o) close();
      }}
      title={t`Enjoying CadabraCraft?`}
    >
      <div className="flex flex-col gap-4">
        <Notice tone="success" strong className="flex items-center gap-2">
          <CircleCheck size={16} aria-hidden />
          {t`Exported ${exported ?? ""}`}
        </Notice>
        <p className="text-sm leading-relaxed">{t`CadabraCraft is free and source-available, and your book stays on your computer. If it helps you finish a book, a sponsorship pays for the time that goes into it.`}</p>
        <p className="text-xs leading-relaxed text-ink-muted">{t`Nothing is sent anywhere unless you press Sponsor, which opens GitHub in your browser.`}</p>
        <div className="flex flex-wrap items-center gap-2.5">
          <Button
            variant="ghost"
            className="text-ink-muted"
            onClick={never}
          >{t`Don't show again`}</Button>
          <span className="flex-1" />
          <Button onClick={snooze}>{t`Maybe later`}</Button>
          <Button
            variant="primary"
            icon={Heart}
            onClick={() => void sponsor()}
          >{t`Sponsor`}</Button>
        </div>
      </div>
    </Modal>
  );
}
