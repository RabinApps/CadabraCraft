import type { MetadataRoute } from "next";
import { LOCALES, localePath } from "@/i18n/config";
import { pagesFor } from "@/lib/pages";
import { languageAlternates } from "@/lib/seo";
import { SITE_URL } from "@/lib/site";

export const dynamic = "force-static";

export default function sitemap(): MetadataRoute.Sitemap {
  return LOCALES.flatMap((locale) =>
    pagesFor(locale).map((p) => ({
      url: `${SITE_URL}${localePath(locale, p.path)}`,
      lastModified: p.lastModified,
      alternates: {
        languages: Object.fromEntries(
          Object.entries(languageAlternates(p.path)).map(([k, v]) => [k, `${SITE_URL}${v}`]),
        ),
      },
    })),
  );
}
