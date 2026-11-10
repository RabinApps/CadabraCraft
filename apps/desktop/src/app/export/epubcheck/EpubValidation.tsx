import { useEffect, useRef, useState } from "react";
import { exportDir } from "@cadabracraft/format";
import { useLingui } from "@lingui/react/macro";
import { ShieldCheck } from "lucide-react";
import { bridge, type EpubcheckReport } from "../../../lib/bridge";
import {
  asFailure,
  checksFromReport,
  failureText,
  summaryText,
} from "../../../lib/export/epubcheckReport";
import { useProject } from "../../../state/project";
import { useSettings } from "../../../state/view/editorPrefs";
import { Button } from "../../../ui/Button";
import { Switch } from "../../../ui/forms/Switch";
import { useEpubCheckSignal } from "./epubAutoCheck";
import { CheckList } from "../CheckList";

type State =
  | { stage: "idle" }
  | { stage: "running" }
  | { stage: "done"; report: EpubcheckReport }
  | { stage: "failed"; text: string };

/**
 * Runs EPUBCheck (the W3C validator, bundled with the app) on the exported EPUB of one edition, on demand or, with the switch on,
 * each time the signal changes (the dialog raises it after an EPUB export, see `raiseEpubCheck`). Nothing leaves the computer.
 */
export function EpubValidation({ language, disabled }: { language: string; disabled: boolean }) {
  const { t } = useLingui();
  const signal = useEpubCheckSignal((s) => s.signal);
  const root = useProject((s) => s.root);
  const { validateEpub, set } = useSettings();
  const [state, setState] = useState<State>({ stage: "idle" });
  const run = useRef(0);

  const check = async () => {
    if (!root) return;
    const id = ++run.current;
    setState({ stage: "running" });
    try {
      const report = await bridge.epubcheckValidate(root, `${exportDir(language)}/book.epub`);
      if (id === run.current) setState({ stage: "done", report });
    } catch (e) {
      const failure = asFailure(e);
      if (id === run.current)
        setState(
          failure.kind === "cancelled"
            ? { stage: "idle" }
            : { stage: "failed", text: failureText(failure) },
        );
    }
  };
  const stop = () => {
    run.current++;
    setState({ stage: "idle" });
    void bridge.epubcheckCancel().catch(() => undefined);
  };

  // Leaving the panel (another format, closing the dialog) stops a check in progress.
  useEffect(
    () => () => {
      run.current++;
      void bridge.epubcheckCancel().catch(() => undefined);
    },
    [],
  );
  // The dialog raises the signal after an export while the switch is on.
  const last = useRef(signal);
  useEffect(() => {
    if (signal !== last.current) {
      last.current = signal;
      if (validateEpub) void check();
    }
  }, [signal]);

  const running = state.stage === "running";
  return (
    <section
      aria-labelledby="epubcheck-title"
      className="flex flex-col gap-3 border-t border-border pt-4"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex flex-col gap-0.5">
          <h3 id="epubcheck-title" className="text-sm font-semibold">
            {t`Check with EPUBCheck`}
          </h3>
          <p className="text-xs text-ink-muted">{t`The EPUB validator used by e-book stores. It runs on your computer and checks the file you exported.`}</p>
        </div>
        {running ? (
          <Button type="button" variant="secondary" size="sm" onClick={stop}>
            {t`Stop`}
          </Button>
        ) : (
          <Button
            type="button"
            variant="secondary"
            size="sm"
            icon={ShieldCheck}
            disabled={disabled || !root}
            onClick={() => void check()}
          >
            {t`Check EPUB`}
          </Button>
        )}
      </div>
      <div role="status" aria-live="polite" className="flex flex-col gap-2">
        {running && (
          <p className="text-sm text-ink-muted">{t`Checking with EPUBCheck. This takes a few seconds…`}</p>
        )}
        {state.stage === "failed" && (
          <p className="rounded-md bg-warn-soft px-3 py-2 text-sm text-warn">{state.text}</p>
        )}
        {state.stage === "done" && (
          <>
            <p className="text-sm font-medium">{summaryText(state.report)}</p>
            <CheckList checks={checksFromReport(state.report)} label={t`EPUBCheck results`} />
            <p className="text-xs text-ink-muted">{t`EPUBCheck ${state.report.version}. Its messages are in English.`}</p>
          </>
        )}
      </div>
      <div className="flex items-center justify-between gap-3 text-sm">
        <span>{t`Check the EPUB after every export`}</span>
        <Switch
          label={t`Check the EPUB after every export`}
          checked={validateEpub}
          onChange={(v) => set({ validateEpub: v })}
        />
      </div>
    </section>
  );
}
