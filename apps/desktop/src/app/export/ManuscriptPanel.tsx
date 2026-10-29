import { useLingui } from "@lingui/react/macro";
import type { ManuscriptFont } from "@cadabracraft/export-docx";
import { Select } from "../../ui/Select";
import { useFontList } from "../hooks/useFontList";

/** The Word and Rich Text formats: the manuscript font. */
export function ManuscriptPanel({
  font,
  onFont,
  disabled,
}: {
  font: ManuscriptFont;
  onFont: (f: ManuscriptFont) => void;
  disabled: boolean;
}) {
  const { t } = useLingui();
  const { families } = useFontList();
  const others = families.filter((f) => !/^(times new roman|courier new)$/i.test(f));
  return (
    <Select
      label={t`Font`}
      value={font}
      disabled={disabled}
      onChange={(e) => onFont(e.target.value as ManuscriptFont)}
      hint={t`Times New Roman 12 pt is what most agents and editors ask for. Courier New is the typewriter look some still prefer. The reader's computer needs any other font to see it.`}
    >
      <option value="times">Times New Roman</option>
      <option value="courier">Courier New</option>
      {others.map((f) => (
        <option key={f} value={f}>
          {f}
        </option>
      ))}
    </Select>
  );
}
