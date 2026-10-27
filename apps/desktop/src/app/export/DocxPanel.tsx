import { useLingui } from "@lingui/react/macro";
import type { ManuscriptFont as DocxFont } from "@cadabracraft/export-docx";
import { Select } from "../../ui/Select";

/** The Word format: the manuscript font. */
export function DocxPanel({ font, onFont, disabled }: { font: DocxFont; onFont: (f: DocxFont) => void; disabled: boolean }) {
  const { t } = useLingui();
  return (
    <Select label={t`Font`} value={font} disabled={disabled} onChange={(e) => onFont(e.target.value as DocxFont)} hint={t`Times New Roman 12 pt is what most agents and editors ask for. Courier New is the typewriter look some still prefer.`}>
      <option value="times">Times New Roman</option>
      <option value="courier">Courier New</option>
    </Select>
  );
}
