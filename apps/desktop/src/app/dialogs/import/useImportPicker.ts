import type { MutableRefObject } from "react";
import { useLingui } from "@lingui/react/macro";
import { causeText } from "../../../lib/projectError";
import type { Feedback } from "./ImportSteps";

/**
 * Opens the file or folder chooser for the import dialog. A cancelled chooser answers null; one that answers after the dialog
 * was closed or reset (`gen` moved on) is ignored.
 */
export function useImportPicker({
  gen,
  busy,
  feedback,
  pickSource,
  pickFolder,
}: {
  gen: MutableRefObject<number>;
  busy: boolean;
  feedback: Feedback;
  pickSource: () => Promise<string | null>;
  pickFolder: () => Promise<string | null>;
}) {
  const { t } = useLingui();
  return (which: "file" | "folder", then: (p: string) => void) => {
    if (busy) return;
    feedback.clear();
    const mine = gen.current;
    (which === "file" ? pickSource : pickFolder)()
      .then((p) => {
        if (p && mine === gen.current) then(p);
      })
      .catch((e) => {
        if (mine === gen.current)
          feedback.fail(t`Could not open the chooser (${causeText(e)}). Try again.`, which);
      });
  };
}
