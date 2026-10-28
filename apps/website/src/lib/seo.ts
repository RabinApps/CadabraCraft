import type { Metadata } from "next";
import { OG_IMAGE, SITE_NAME, SITE_URL } from "./site";

type Options = {
  /** Defaults to the shared social card. */
  image?: string;
  /** "article" for guides; everything else is "website". */
  type?: "website" | "article";
  /** Keep the page out of search results (the 404 page). */
  noindex?: boolean;
};

/** Per-page metadata with canonical URL and OpenGraph/Twitter cards. `path` starts and ends with "/". */
export function pageMetadata(title: string, description: string, path: string, options: Options = {}): Metadata {
  const url = `${SITE_URL}${path}`;
  const image = options.image ?? OG_IMAGE;
  return {
    title,
    description,
    alternates: { canonical: path },
    ...(options.noindex ? { robots: { index: false, follow: true } } : {}),
    openGraph: {
      title,
      description,
      url,
      siteName: SITE_NAME,
      type: options.type ?? "website",
      images: [{ url: image, width: 1200, height: 630, alt: `${SITE_NAME}: write and format your book` }],
    },
    twitter: { card: "summary_large_image", title, description, images: [image] },
  };
}

/** A BreadcrumbList for structured data. Items are [name, path] pairs, outermost first. */
export function breadcrumbLd(items: readonly (readonly [string, string])[]) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map(([name, path], i) => ({
      "@type": "ListItem",
      position: i + 1,
      name,
      item: `${SITE_URL}${path}`,
    })),
  };
}
