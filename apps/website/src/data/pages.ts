import { competitors } from "./competitors";
import { guides } from "./guides";

/** Last substantive edit of each page (YYYY-MM-DD). Constants, not build time, so the sitemap is deterministic. */
export const SITE_UPDATED = "2026-10-27";

export type PageEntry = { path: string; lastModified: string };

/** Every indexable route, for the sitemap. Compare pages use the date their facts were checked. */
export const pages: PageEntry[] = [
  { path: "/", lastModified: SITE_UPDATED },
  { path: "/features/", lastModified: SITE_UPDATED },
  { path: "/formats/", lastModified: SITE_UPDATED },
  { path: "/compare/", lastModified: SITE_UPDATED },
  ...competitors.map((c) => ({ path: `/compare/${c.slug}/`, lastModified: c.checkedOn })),
  { path: "/guides/", lastModified: SITE_UPDATED },
  ...guides.map((g) => ({ path: `/guides/${g.slug}/`, lastModified: g.updated })),
  { path: "/download/", lastModified: SITE_UPDATED },
  { path: "/changelog/", lastModified: SITE_UPDATED },
  { path: "/support/", lastModified: SITE_UPDATED },
];
