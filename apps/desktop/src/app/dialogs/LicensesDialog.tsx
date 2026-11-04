import { useLingui } from "@lingui/react/macro";
import { useEffect, useState } from "react";
import { bridge } from "../../lib/bridge";
import { whyText } from "../../lib/projectError";
import { LICENSE_DOCS, type LicenseDoc, useLicenses } from "../../state/licenses";
import { Button } from "../../ui/Button";
import { Modal } from "../../ui/Dialog";
import { Segmented } from "../../ui/Segmented";

/**
 * Help > Licenses: the app's own license and the notices for everything that ships with it. The text is read from the
 * files bundled in the installer (`licenses/`), so what is shown is what was shipped.
 */
export function LicensesDialog() {
  const { t } = useLingui();
  const open = useLicenses((s) => s.open);
  const [doc, setDoc] = useState<LicenseDoc>("license");
  const [text, setText] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [tries, setTries] = useState(0);
  useEffect(() => {
    if (!open) return;
    let current = true;
    setText(null);
    setError("");
    bridge.readLicense(doc).then(
      (body) => current && setText(body),
      (e) => current && setError(whyText(e)),
    );
    return () => {
      current = false;
    };
  }, [open, doc, tries]);
  const labels: Record<LicenseDoc, string> = {
    license: t`License`,
    clarifications: t`Clarifications`,
    notice: t`Notice`,
    programs: t`Programs and fonts`,
    rust: t`Rust libraries`,
    npm: t`JavaScript libraries`,
  };
  return (
    <Modal
      open={open}
      onOpenChange={(o) => {
        if (!o) useLicenses.getState().close();
      }}
      title={t`Licenses`}
      description={t`CadabraCraft is source-available. These are its license and the licenses of the software that ships with it.`}
      size="xl"
    >
      <div className="flex flex-col gap-3">
        <Segmented
          label={t`Document`}
          value={doc}
          onChange={setDoc}
          items={LICENSE_DOCS.map((value) => ({ value, label: labels[value] }))}
        />
        {error ? (
          <div className="flex flex-wrap items-center gap-3">
            <p
              id="license-error"
              role="alert"
              className="text-small text-danger"
            >{t`Could not read this document: ${error}. Try again, or choose another document.`}</p>
            <Button aria-describedby="license-error" onClick={() => setTries((n) => n + 1)}>
              {t`Try again`}
            </Button>
          </div>
        ) : (
          <pre
            tabIndex={0}
            aria-label={labels[doc]}
            className="max-h-[55dvh] overflow-auto whitespace-pre-wrap break-words rounded-md border border-border bg-sidebar p-3 font-mono text-caption leading-relaxed"
          >
            {text ?? t`Loading…`}
          </pre>
        )}
      </div>
    </Modal>
  );
}
