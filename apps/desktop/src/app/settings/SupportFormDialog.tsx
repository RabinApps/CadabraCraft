import { useEffect, useRef, useState } from "react";
import { useLingui } from "@lingui/react/macro";
import { ExternalLink } from "lucide-react";
import { bridge } from "../../lib/bridge";
import {
  FORM_LOAD_TIMEOUT_MS,
  formHeightFrom,
  frameHeight,
  supportFormUrl,
  type SupportForm,
} from "../../lib/support/supportForm";
import { Button } from "../../ui/Button";
import { Modal } from "../../ui/Dialog";
import { Notice } from "../../ui/feedback/Notice";

/**
 * The Contact and Feedback forms from the support desk, in a dialog. The page behind the frame is requested only once
 * the dialog is open, never at start-up. If it does not load (no connection, blocked), the dialog says so and offers
 * the same form in the author's browser.
 */
export function SupportFormDialog({
  form,
  onClose,
}: {
  form: SupportForm | null;
  onClose: () => void;
}) {
  const { t } = useLingui();
  const title = form === "feedback" ? t`Feedback for CadabraCraft` : t`Contact CadabraCraft`;
  return (
    <Modal open={form !== null} onOpenChange={(o) => !o && onClose()} title={title} size="md">
      {form && <FormFrame key={form} form={form} title={title} onClose={onClose} />}
    </Modal>
  );
}

function FormFrame({
  form,
  title,
  onClose,
}: {
  form: SupportForm;
  title: string;
  onClose: () => void;
}) {
  const { t } = useLingui();
  const frame = useRef<HTMLIFrameElement>(null);
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(() => !navigator.onLine);
  const [height, setHeight] = useState<number | null>(null);
  const [openError, setOpenError] = useState("");
  const url = supportFormUrl(form);

  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      const h = formHeightFrom(e, frame.current?.contentWindow);
      if (h !== null) setHeight(h);
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  useEffect(() => {
    if (loaded || failed) return;
    const timer = setTimeout(() => setFailed(true), FORM_LOAD_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [loaded, failed]);

  const openInBrowser = () => {
    setOpenError("");
    bridge
      .openUrl(url)
      .catch(() =>
        setOpenError(t`Could not open ${url}. Copy the address into your browser instead.`),
      );
  };

  return (
    <div className="flex flex-col gap-4">
      {failed ? (
        <div className="flex flex-col items-start gap-3">
          <Notice tone="warn" role="alert">
            {t`The form could not load. Check your connection, or open it in your browser.`}
          </Notice>
          <Button icon={ExternalLink} onClick={openInBrowser}>{t`Open in browser`}</Button>
          {openError && <Notice role="alert">{openError}</Notice>}
        </div>
      ) : (
        <iframe
          ref={frame}
          src={url}
          title={title}
          onLoad={() => setLoaded(true)}
          referrerPolicy="no-referrer"
          sandbox="allow-scripts allow-forms allow-same-origin allow-popups"
          style={{ height: frameHeight(form, height) }}
          className="mx-auto block w-full rounded-md border-0"
        />
      )}
      <p className="text-xs leading-relaxed text-ink-muted">{t`The form comes from support.cadabracraft.com and is only loaded when you open it. Nothing is sent until you submit the form.`}</p>
      <div className="flex justify-end">
        <Button onClick={onClose}>{t`Close`}</Button>
      </div>
    </div>
  );
}
