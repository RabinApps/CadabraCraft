import { useLingui } from "@lingui/react/macro";
import { cleanPageZoom, type PageZoom } from "../../state/editorPrefs";
import { Select } from "../../ui/Select";

const stored = (z: PageZoom): string => String(z);

/** The zoom of the pages in Page view: "Fit width" or a fixed scale. Compact, for the status bar. */
export function PageZoomSelect({
  zoom,
  onChange,
}: {
  zoom: PageZoom;
  onChange: (z: PageZoom) => void;
}) {
  const { t } = useLingui();
  return (
    <Select
      label={t`Page zoom`}
      hideLabel
      value={stored(zoom)}
      onChange={(e) =>
        onChange(cleanPageZoom(e.target.value === "fit" ? "fit" : Number(e.target.value)))
      }
      className="w-auto px-2 py-0.5 text-xs"
    >
      <option value="fit">{t`Fit width`}</option>
      <option value="0.75">75%</option>
      <option value="1">100%</option>
      <option value="1.25">125%</option>
    </Select>
  );
}
