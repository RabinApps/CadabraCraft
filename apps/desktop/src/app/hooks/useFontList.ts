import { useCallback, useEffect, useState } from "react";
import { bridge, type InstalledFont } from "../../lib/bridge";
import { mergeFonts, printFamilies, type FontEntry } from "../../lib/font/fontList";

/**
 * The families Typst sees on this computer, asked once until the font library changes (Typst also lists the
 * app's own downloaded and imported fonts, so a download, import or delete must ask again).
 */
let systemFonts: Promise<string[]> | null = null;
// Without Typst there is no list; the author still has the app's own fonts.
const loadSystem = (): Promise<string[]> =>
  (systemFonts ??= bridge.typstListFonts().catch(() => []));

/** Every font the author can pick (bundled, installed, downloaded, imported), and a `refresh` for after a download, import or delete. */
export function useFontList(): {
  fonts: FontEntry[];
  /** Family names for the PDF and Word selects. */
  families: string[];
  refresh: () => Promise<void>;
} {
  const [system, setSystem] = useState<string[]>([]);
  const [kept, setKept] = useState<InstalledFont[]>([]);
  const refresh = useCallback(async () => {
    systemFonts = null;
    const [sys, own] = await Promise.all([loadSystem(), bridge.fontsInstalled().catch(() => [])]);
    setSystem(sys);
    setKept(own);
  }, []);
  useEffect(() => {
    let live = true;
    void loadSystem().then((s) => live && setSystem(s));
    void bridge
      .fontsInstalled()
      .catch(() => [])
      .then((k) => live && setKept(k));
    return () => {
      live = false;
    };
  }, []);
  return { fonts: mergeFonts(system, kept), families: printFamilies(system, kept), refresh };
}
