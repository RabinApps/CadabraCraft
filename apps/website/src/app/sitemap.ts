import type { MetadataRoute } from "next";
import { competitors } from "@/data/competitors";
import { SITE_URL } from "@/lib/site";

export const dynamic = "force-static";

export default function sitemap(): MetadataRoute.Sitemap {
  const paths = [
    "/",
    "/features/",
    "/compare/",
    ...competitors.map((c) => `/compare/${c.slug}/`),
    "/support/",
    "/download/",
  ];
  return paths.map((p) => ({ url: `${SITE_URL}${p}` }));
}
