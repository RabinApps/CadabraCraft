import type { Metadata } from "next";
import { SITE_NAME, SITE_URL } from "./site";

export const OG_IMAGE = "/og/cadabracraft-og.png";

/** Per-page metadata with canonical URL and OpenGraph/Twitter cards. `path` starts and ends with "/". */
export function pageMetadata(title: string, description: string, path: string): Metadata {
  const url = `${SITE_URL}${path}`;
  return {
    title,
    description,
    alternates: { canonical: path },
    openGraph: {
      title,
      description,
      url,
      siteName: SITE_NAME,
      type: "website",
      images: [{ url: OG_IMAGE, width: 1200, height: 630, alt: `${SITE_NAME}: write and format your book` }],
    },
    twitter: { card: "summary_large_image", title, description, images: [OG_IMAGE] },
  };
}
