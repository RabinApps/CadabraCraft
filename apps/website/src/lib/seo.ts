import type { Metadata } from "next";
import { DEFAULT_LOCALE, LOCALES, localePath, type Locale } from "@/i18n/config";
import { OG_IMAGE, SITE_NAME, SITE_URL } from "./site";

type Options = {
  /** Defaults to the shared social card. */
  image?: string;
  /** "article" for guides; everything else is "website". */
  type?: "website" | "article";
  /** Keep the page out of search results (the 404 page). */
  noindex?: boolean;
};

/** hreflang map for a locale-less `path`: one entry per locale plus x-default. */
export function languageAlternates(path: string): Record<string, string> {
  const map: Record<string, string> = {};
  for (const l of LOCALES) map[l] = localePath(l, path);
  map["x-default"] = localePath(DEFAULT_LOCALE, path);
  return map;
}

/**
 * Per-page metadata with canonical URL, hreflang and OpenGraph/Twitter cards.
 * `path` is the locale-less route and starts and ends with "/", e.g. "/features/".
 */
export function pageMetadata(
  locale: Locale,
  title: string,
  description: string,
  path: string,
  options: Options = {},
): Metadata {
  const localized = localePath(locale, path);
  const url = `${SITE_URL}${localized}`;
  const image = options.image ?? OG_IMAGE;
  return {
    title,
    description,
    alternates: { canonical: localized, languages: languageAlternates(path) },
    ...(options.noindex ? { robots: { index: false, follow: true } } : {}),
    openGraph: {
      title,
      description,
      url,
      siteName: SITE_NAME,
      type: options.type ?? "website",
      locale,
      images: [{ url: image, width: 1200, height: 630, alt: `${SITE_NAME}: write and format your book` }],
    },
    twitter: { card: "summary_large_image", title, description, images: [image] },
  };
}

/** A BreadcrumbList for structured data. Items are [name, locale-less path] pairs, outermost first. */
export function breadcrumbLd(locale: Locale, items: readonly (readonly [string, string])[]) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map(([name, path], i) => ({
      "@type": "ListItem",
      position: i + 1,
      name,
      item: `${SITE_URL}${localePath(locale, path)}`,
    })),
  };
}
