import { useEffect, useState } from "react";
import { useLingui } from "@lingui/react/macro";
import { Trash2 } from "lucide-react";
import { bridge } from "../../lib/bridge";
import { describeFontError } from "../../lib/fontErrors";
import { forgetLoadedFonts, ensureFontLoaded } from "../../lib/loadFont";
import type { FontEntry, FontSource } from "../../lib/fontList";
import { Button, IconButton } from "../../ui/Button";
import { cx } from "../../ui/cx";
import { useFontList } from "../hooks/useFontList";
import { FontsCatalogDialog } from "./FontsCatalogDialog";
import { Row, Section } from "./SettingsParts";

const badgeTone: Record<FontSource, string> = {
  bundled: "border border-border-strong bg-bg text-ink-muted",
  installed: "border border-border-strong bg-bg text-ink-muted",
  downloaded: "bg-accent-soft text-accent",
  imported: "bg-success-soft text-success",
};

/** The fonts the author can use, with a way to download more from the catalog or import a file. Nothing is fetched until Download is clicked. */
export function FontsSection({ title }: { title: string }) {
  const { t } = useLingui();
  const { fonts, refresh } = useFontList();
  const [catalogOpen, setCatalogOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const badge: Record<FontSource, string> = {
    bundled: t`Installed`,
    installed: t`Installed`,
    downloaded: t`Downloaded`,
    imported: t`Imported`,
  };
  // So each downloaded or imported name is drawn in its own typeface.
  useEffect(() => {
    for (const f of fonts) if (f.id) void ensureFontLoaded(f.family);
  }, [fonts]);
  const stack = (f: FontEntry) =>
    f.source === "bundled"
      ? f.family === "Inter"
        ? "var(--font-ui)"
        : "var(--font-book)"
      : `"${f.family.replace(/["\\]/g, "\\$&")}", var(--font-ui)`;
  const remove = async (f: FontEntry) => {
    if (!f.id) return;
    setError(null);
    try {
      await bridge.fontsDelete(f.id);
      forgetLoadedFonts();
    } catch (e) {
      setError(describeFontError(e).message);
    }
    await refresh();
  };
  const importFile = async () => {
    setError(null);
    setBusy(true);
    try {
      const path = await bridge.pickFontFile();
      if (path) await bridge.fontsImport(path);
    } catch (e) {
      setError(describeFontError(e).message);
    } finally {
      setBusy(false);
    }
    await refresh();
  };
  return (
    <Section id="fonts" title={title}>
      <div className="flex flex-col gap-1 px-4 py-3.5">
        <span className="text-sm font-semibold">{t`Your fonts`}</span>
        <ul className="mt-1 flex max-h-80 flex-col divide-y divide-border overflow-y-auto">
          {fonts.map((f) => (
            <li
              key={`${f.source}:${f.family}`}
              data-testid={`font-${f.family}`}
              className="flex items-center justify-between gap-3 py-2"
            >
              <span className="min-w-0 truncate text-base" style={{ fontFamily: stack(f) }}>
                {f.family}
              </span>
              <span className="flex shrink-0 items-center gap-2">
                <span
                  className={cx(
                    "rounded-full px-2.5 py-1 text-xs font-semibold",
                    badgeTone[f.source],
                  )}
                >
                  {badge[f.source]}
                </span>
                {f.id && (
                  <IconButton
                    icon={Trash2}
                    label={t`Delete ${f.family}`}
                    onClick={() => void remove(f)}
                  />
                )}
              </span>
            </li>
          ))}
        </ul>
      </div>
      <Row
        title={t`Download fonts`}
        hint={t`Fonts are downloaded from Google Fonts only when you click Download. Nothing else is sent.`}
        control={<Button onClick={() => setCatalogOpen(true)}>{t`Browse fonts…`}</Button>}
      />
      <Row
        title={t`Import a font file`}
        hint={t`.ttf and .otf files. A copy is kept in the app, never in your book.`}
        control={
          <Button disabled={busy} onClick={() => void importFile()}>{t`Choose file…`}</Button>
        }
      />
      {error && (
        <p role="alert" className="px-4 py-3 text-sm text-danger">
          {error}
        </p>
      )}
      <FontsCatalogDialog
        open={catalogOpen}
        onOpenChange={setCatalogOpen}
        onChanged={() => void refresh()}
      />
    </Section>
  );
}
