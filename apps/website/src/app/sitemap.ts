import type { MetadataRoute } from "next";
import { pages } from "@/data/pages";
import { SITE_URL } from "@/lib/site";

export const dynamic = "force-static";

export default function sitemap(): MetadataRoute.Sitemap {
  return pages.map((p) => ({ url: `${SITE_URL}${p.path}`, lastModified: p.lastModified }));
}
