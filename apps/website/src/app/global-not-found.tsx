import type { Metadata } from "next";
import { NotFoundBody } from "@/components/NotFoundBody";
import { SiteFooter } from "@/components/SiteFooter";
import { SiteHeader } from "@/components/SiteHeader";
import { DEFAULT_LOCALE } from "@/i18n/config";
import "./globals.css";

// Used for URLs that match no route (GitHub Pages serves this as 404.html). No canonical: it is not a real page.
export const metadata: Metadata = {
  title: "Page not found | CadabraCraft",
  robots: { index: false, follow: true },
};

export default function GlobalNotFound() {
  return (
    <html lang={DEFAULT_LOCALE}>
      <body className="antialiased">
        <SiteHeader locale={DEFAULT_LOCALE} />
        <main id="top">
          <NotFoundBody locale={DEFAULT_LOCALE} />
        </main>
        <SiteFooter locale={DEFAULT_LOCALE} />
      </body>
    </html>
  );
}
