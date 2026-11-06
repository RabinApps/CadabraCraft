import { useLingui } from "@lingui/react/macro";
import { epubChecks } from "../../lib/export/exportChecks";
import { useProject } from "../../state/project";
import type { ExportScope } from "../../state/project/types";
import { CheckList } from "./CheckList";
import { useAltPages } from "./useAltPages";

/** The EPUB format: the accessibility checks for the book as it is now. Mounted only while the dialog shows EPUB. */
export function EpubPanel({ language }: ExportScope) {
  const { t } = useLingui();
  const manifest = useProject((s) => s.manifest);
  const altPages = useAltPages(language);
  const checks = manifest ? epubChecks(manifest, altPages, { language }) : [];
  return <CheckList checks={checks} label={t`Checks`} />;
}
