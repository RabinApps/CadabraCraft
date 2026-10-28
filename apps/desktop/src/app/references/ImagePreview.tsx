import { useRef, useState } from "react";
import { useLingui } from "@lingui/react/macro";
import { Maximize, ZoomIn, ZoomOut } from "lucide-react";
import { IconButton } from "../../ui/Button";

const STEP = 1.25;
const MIN = 48;
/** The most it can be enlarged, as a multiple of the image's own width. */
const MAX_TIMES = 8;

/** An image that fits the stage until the author zooms; zoomed, it scrolls (pan) inside the stage. */
export function ImagePreview({ url, title }: { url: string; title: string }) {
  const { t } = useLingui();
  const img = useRef<HTMLImageElement>(null);
  /** The shown width in pixels, or null while the image fits the stage. */
  const [width, setWidth] = useState<number | null>(null);
  const [natural, setNatural] = useState(0);
  const max = Math.max(MIN, natural * MAX_TIMES);
  const zoom = (factor: number) =>
    setWidth(
      Math.min(max, Math.max(MIN, Math.round((width ?? img.current!.clientWidth) * factor))),
    );
  return (
    <>
      <div
        role="toolbar"
        aria-label={t`Image zoom`}
        className="flex items-center gap-1 border-b border-border bg-surface px-3 py-1.5"
      >
        <IconButton
          icon={ZoomOut}
          label={t`Zoom out`}
          disabled={width !== null && width <= MIN}
          onClick={() => zoom(1 / STEP)}
        />
        <IconButton
          icon={ZoomIn}
          label={t`Zoom in`}
          disabled={width !== null && width >= max}
          onClick={() => zoom(STEP)}
        />
        <IconButton
          icon={Maximize}
          label={t`Fit to window`}
          disabled={width === null}
          onClick={() => setWidth(null)}
        />
      </div>
      <div className="flex min-h-0 flex-1 overflow-auto bg-sidebar p-4">
        <img
          ref={img}
          onLoad={(e) => setNatural(e.currentTarget.naturalWidth)}
          src={url}
          alt={title}
          style={width === null ? undefined : { width, maxWidth: "none", maxHeight: "none" }}
          className={width === null ? "m-auto max-h-full max-w-full object-contain" : "m-auto"}
        />
      </div>
    </>
  );
}
