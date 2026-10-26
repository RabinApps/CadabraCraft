import type { Metadata } from "next";
import { SITE_NAME, SITE_URL } from "./site";

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
    },
    twitter: { card: "summary", title, description },
  };
}
