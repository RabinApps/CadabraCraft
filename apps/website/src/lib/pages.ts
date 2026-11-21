import { getContent } from "@/content";
import type { Locale } from "@/i18n/config";
import { listEntries } from "./docs/entries";

/** Last substantive edit of each page (YYYY-MM-DD). Constants, not build time, so the sitemap is deterministic. */
export const SITE_UPDATED = "2026-11-21";

export type PageEntry = { path: string; lastModified: string };

/** Locale-less paths of every static marketing page. Legacy redirects are generated from this list too. */
export const STATIC_PATHS = [
  "/",
  "/features/",
  "/formats/",
  "/compare/",
  "/guides/",
  "/docs/",
  "/download/",
  "/changelog/",
  "/support/",
];

/** Every indexable route for a locale (paths without the locale prefix). Compare pages use the date their facts were checked. */
export function pagesFor(locale: Locale): PageEntry[] {
  const { competitors } = getContent(locale).competitors;
  return [
    ...STATIC_PATHS.map((path) => ({ path, lastModified: SITE_UPDATED })),
    ...competitors.map((c) => ({ path: `/compare/${c.slug}/`, lastModified: c.checkedOn })),
    ...listEntries(locale, "guides").map((g) => ({
      path: `/guides/${g.slug}/`,
      lastModified: g.updated,
    })),
    ...listEntries(locale, "docs").map((d) => ({
      path: `/docs/${d.slug}/`,
      lastModified: d.updated,
    })),
  ];
}
