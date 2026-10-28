import { useCallback, useEffect, useState } from "react";
import { bridge, type InstalledFont } from "../../lib/bridge";
import { mergeFonts, printFamilies, type FontEntry } from "../../lib/fontList";
import { readTypstPath } from "../../lib/typstPath";

/**
 * The families Typst sees on this computer, asked once per Typst location until the font library changes (Typst also lists the
 * app's own downloaded and imported fonts, so a download, import or delete must ask again).
 */
const systemFonts = new Map<string, Promise<string[]>>();
const loadSystem = (): Promise<string[]> => {
  const path = readTypstPath().trim();
  let p = systemFonts.get(path);
  if (!p) {
    // Without Typst there is no list; the author still has the app's own fonts.
    p = bridge.typstListFonts(path || null).catch(() => []);
    systemFonts.set(path, p);
  }
  return p;
};

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
    systemFonts.clear();
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
