import { sourceEdition } from "@cadabracraft/format";
import { useLingui } from "@lingui/react/macro";
import { epubChecks } from "../../lib/export/exportChecks";
import { useProject } from "../../state/project";
import type { ExportScope } from "../../state/project/types";
import { CheckList } from "./CheckList";
import { EpubValidation } from "./epubcheck/EpubValidation";
import { useAltPages } from "./useAltPages";

/** The EPUB format: the accessibility checks for the book as it is now, then the EPUBCheck validation of the exported file. Mounted only while the dialog shows EPUB. */
export function EpubPanel({ language, disabled }: ExportScope & { disabled: boolean }) {
  const { t } = useLingui();
  const manifest = useProject((s) => s.manifest);
  const altPages = useAltPages(language);
  const checks = manifest ? epubChecks(manifest, altPages, { language }) : [];
  const edition = language ?? (manifest ? sourceEdition(manifest.editions).language : "");
  return (
    <div className="flex flex-col gap-4">
      <CheckList checks={checks} label={t`Checks`} />
      <EpubValidation language={edition} disabled={disabled} />
    </div>
  );
}
