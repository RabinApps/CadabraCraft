import { useCallback, useEffect, useState } from "react";
import { useLingui } from "@lingui/react/macro";
import { Check } from "lucide-react";
import { bridge, type FontPack } from "../../lib/bridge";
import { describeFontError } from "../../lib/fontErrors";
import { formatMb } from "../../lib/fontList";
import { Button } from "../../ui/Button";
import { Modal } from "../../ui/Dialog";
import { Notice } from "../../ui/Notice";
import { ProgressBar } from "../../ui/ProgressBar";
import { useProject } from "../../state/project";

/** Short name of the catalog's licence id, as the design shows it. */
const licenceName = (id: string, fallback: string): string => (id === "OFL-1.1" ? fallback : id);

/** The catalog of fonts that can be downloaded (open-licence families). Nothing is fetched until Download is clicked. */
export function FontsCatalogDialog({
  open,
  onOpenChange,
  onChanged,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** A family finished downloading: the font list should be read again. */
  onChanged: () => void;
}) {
  const { t } = useLingui();
  const downloads = useProject((s) => s.fontDownloads);
  const download = useProject((s) => s.actions.downloadFont);
  const cancel = useProject((s) => s.actions.cancelFontDownload);
  const dismiss = useProject((s) => s.actions.dismissFontDownload);
  const [catalog, setCatalog] = useState<FontPack[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const refresh = useCallback(async () => {
    try {
      setCatalog(await bridge.fontsCatalog());
      setLoadError(null);
    } catch (e) {
      setLoadError(describeFontError(e).message);
    }
  }, []);
  useEffect(() => {
    if (open) void refresh();
  }, [open, refresh]);
  const start = async (f: FontPack) => {
    if (await download(f.id, f.bytes)) {
      await refresh();
      onChanged();
    }
  };
  const failed = catalog.find((f) => downloads[f.id]?.status === "error");
  const failure = failed ? downloads[failed.id]?.error : null;
  return (
    <Modal
      size="md"
      open={open}
      onOpenChange={onOpenChange}
      title={t`Download fonts`}
      description={t`These fonts come from Google Fonts and are free to use under the SIL Open Font Licence. A font is downloaded only when you click Download; nothing else is sent.`}
    >
      <div className="flex flex-col gap-3">
        {(failure || loadError) && <Notice role="alert">{failure?.message ?? loadError}</Notice>}
        <ul className="flex max-h-[52dvh] flex-col divide-y divide-border overflow-y-auto rounded-lg border border-border">
          {catalog.map((f) => {
            const d = downloads[f.id];
            const size = formatMb(f.bytes);
            const styleCount = f.styles.length;
            return (
              <li
                key={f.id}
                data-testid={`catalog-${f.id}`}
                className="flex flex-col gap-2 px-4 py-3"
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="flex min-w-0 flex-col gap-0.5">
                    <span className="font-book text-base font-semibold">{f.family}</span>
                    <span className="text-xs text-ink-muted">
                      {t`${styleCount} styles · ${size} MB`}
                    </span>
                    <button
                      type="button"
                      onClick={() => void bridge.openUrl(f.licenceUrl).catch(() => undefined)}
                      className="w-fit text-xs font-semibold text-accent hover:underline"
                    >
                      {licenceName(f.licence, t`SIL Open Font Licence 1.1`)}
                    </button>
                  </div>
                  {f.installed ? (
                    <span className="inline-flex shrink-0 items-center gap-1.5 text-sm font-semibold text-success">
                      <Check size={16} aria-hidden />
                      {t`Installed`}
                    </span>
                  ) : d?.status === "running" ? (
                    <Button
                      size="sm"
                      disabled={d.cancelling}
                      onClick={() => cancel(f.id)}
                      aria-label={t`Cancel the download of ${f.family}`}
                    >{t`Cancel`}</Button>
                  ) : (
                    <Button
                      size="sm"
                      aria-label={
                        d ? t`Try again to download ${f.family}` : t`Download ${f.family}`
                      }
                      onClick={() => {
                        if (d) dismiss(f.id);
                        void start(f);
                      }}
                    >
                      {d ? t`Try again` : t`Download`}
                    </Button>
                  )}
                </div>
                {d?.status === "running" && (
                  <div className="flex flex-col gap-1">
                    <ProgressBar
                      label={t`Downloading ${f.family}`}
                      value={d.done}
                      max={d.total || f.bytes}
                      className="h-1.5 bg-border"
                    />
                    <span role="status" className="text-xs text-ink-muted">
                      {d.cancelling
                        ? t`Stopping…`
                        : t`Downloading… ${formatMb(d.done)} MB of ${formatMb(d.total || f.bytes)} MB`}
                    </span>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
        <div className="flex justify-end">
          <Button onClick={() => onOpenChange(false)}>{t`Close`}</Button>
        </div>
      </div>
    </Modal>
  );
}
