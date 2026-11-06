import type { CSSProperties } from "react";
import { editorFontStack } from "../../state/view/editorPrefs";
import type { PageKind } from "./core";

/** `pageCssVars` returns two plain properties (text-align, hyphens) next to the custom ones; as variables they all style one container. */
export const cssVarsStyle = (vars: Record<string, string>): CSSProperties =>
  Object.fromEntries(
    Object.entries(vars).map(([k, v]) => [k.startsWith("--") ? k : `--page-${k}`, v]),
  ) as CSSProperties;

/** The first of the template's print body fonts that can be drawn here (bundled, installed, downloaded or imported), as listed. */
export function pickPageFont(bodyFonts: string[], available: string[]): string | null {
  const have = new Map(available.map((f) => [f.toLowerCase(), f]));
  for (const f of bodyFonts) {
    const hit = have.get(f.toLowerCase());
    if (hit) return hit;
  }
  return null;
}

/** The CSS font stack for a family name; the bundled ones map to their own tokens. */
export const pageFontStack = (family: string): string => {
  const key = family.toLowerCase();
  return editorFontStack(
    key === "inter" || key === "newsreader" ? (key as "inter" | "newsreader") : family,
  );
};

/**
 * Running head of a page: the book title on left-hand pages and the entry's title (a chapter's, or a matter page's own) on right-hand
 * ones; none on an opening page, a blank page, or a page of an entry that prints none (`headed`, see `matterHeadsOn`).
 */
export const runningHead = (
  kind: PageKind,
  number: number,
  bookTitle: string,
  entryTitle: string,
  headed: boolean,
): string | null => (!headed || kind !== "body" ? null : number % 2 === 0 ? bookTitle : entryTitle);
