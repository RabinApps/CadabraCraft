import { useEffect, useMemo, useState } from "react";
import type { TrimSize } from "@cadabracraft/export-pdf";
import type { SceneBreakOrnamentId } from "@cadabracraft/shared";
import {
  DEFAULT_TEMPLATE_ID,
  getTemplate,
  hasTemplate,
  resolveTrimSize,
} from "@cadabracraft/templates";
import { readingOrder, sectionOf, sourceEdition, type Manifest } from "@cadabracraft/format";
import { useFontList } from "../../app/hooks/useFontList";
import { editorFontStack } from "../../state/view/editorPrefs";
import { useProject } from "../../state/project/index";
import { ensureFontLoaded } from "../../lib/font/loadFont";
import { pageGeometry, type PageGeometry } from "../../lib/page/pageLayout";
import { pageFontStack, pickPageFont } from "../pagination/frame";

/** What every page of the book shares: the geometry, the print font and the titles. Computed once per view, not per chapter. */
export interface PageLook {
  book: {
    template: string;
    trimSize: TrimSize | undefined;
    sceneBreak: SceneBreakOrnamentId | undefined;
  };
  g: PageGeometry;
  trim: TrimSize;
  print: ReturnType<typeof getTemplate>["print"];
  /** The print font when it can be drawn here, else null (the manuscript font is used). */
  family: string | null;
  fontStack: string;
  bookTitle: string;
  language: string;
}

/**
 * The look of the book's pages: geometry from the trim size and template, and the text font (the template's print font when it can
 * be drawn here, else the bundled serif).
 */
export function usePageLook(): PageLook {
  const manifest = useProject((s) => s.manifest)!;
  const language = useProject((s) => s.activeLanguage ?? s.manifest?.editions[0]?.language ?? "");
  const { fonts } = useFontList();
  const book = useMemo(
    () => ({
      template: manifest.template,
      trimSize: manifest.trimSize,
      sceneBreak: manifest.sceneBreak,
    }),
    [manifest.template, manifest.trimSize, manifest.sceneBreak],
  );
  const g = useMemo(() => pageGeometry(book), [book]);
  const trim = resolveTrimSize(book);
  const print = getTemplate(hasTemplate(book.template) ? book.template : DEFAULT_TEMPLATE_ID).print;
  const printFont = pickPageFont(
    print.bodyFonts,
    fonts.map((f) => f.family),
  );
  const [loadedFont, setLoadedFont] = useState<string | null>(null);
  useEffect(() => {
    if (!printFont) return setLoadedFont(null);
    let live = true;
    void ensureFontLoaded(printFont).then((ok) => live && setLoadedFont(ok ? printFont : null));
    return () => {
      live = false;
    };
  }, [printFont]);
  const family =
    loadedFont ?? (printFont && /^(inter|newsreader)$/i.test(printFont) ? printFont : null);
  const fontStack = family ? pageFontStack(family) : editorFontStack("newsreader");
  const bookTitle =
    manifest.editions.find((e) => e.language === language)?.title ??
    sourceEdition(manifest.editions).title;
  return useMemo(
    () => ({ book, g, trim, print, family, fontStack, bookTitle, language }),
    [book, g, trim, print, family, fontStack, bookTitle, language],
  );
}

/** The 1-based position of `id` among the chapters, for the "CHAPTER n" label; undefined for front and back matter. */
export function chapterNumberOf(manifest: Manifest, id: string | null): number | undefined {
  if (!id || sectionOf(manifest, id) !== "chapter") return undefined;
  if (readingOrder(manifest).find((e) => e.id === id)?.kind === "part") return undefined;
  const n = readingOrder(manifest)
    .filter(
      (e) => sectionOf(manifest, e.id) === "chapter" && e.kind !== "blank" && e.kind !== "part",
    )
    .findIndex((e) => e.id === id);
  return n >= 0 ? n + 1 : undefined;
}
