import { useLingui } from "@lingui/react/macro";
import { imageAltChecks } from "../../lib/exportChecks";
import type { ExportScope } from "../../state/project/types";
import { CheckList } from "./CheckList";
import { useAltPages } from "./useAltPages";

/** The image alt-text warnings for formats that carry alt text (PDF, Word, Rich Text). Shows nothing when every image is described. */
export function AltTextCheck({ language }: ExportScope) {
  const { t } = useLingui();
  const checks = imageAltChecks(useAltPages(language));
  return checks.length === 0 ? null : <CheckList checks={checks} label={t`Image checks`} />;
}
