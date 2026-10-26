import type { Metadata } from "next";
import { Inter, Newsreader } from "next/font/google";
import { JsonLd } from "@/components/JsonLd";
import { SiteFooter } from "@/components/SiteFooter";
import { SiteHeader } from "@/components/SiteHeader";
import { SITE_NAME, SITE_URL } from "@/lib/site";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });
const newsreader = Newsreader({ subsets: ["latin"], variable: "--font-newsreader" });

const description =
  "CadabraCraft is a free, open-source desktop app for writing and formatting books. Local-first, no account, EPUB3 and print PDF export.";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: { default: "CadabraCraft: free book writing and formatting software", template: "%s | CadabraCraft" },
  description,
  openGraph: {
    title: "CadabraCraft: write and format your book",
    description,
    url: SITE_URL,
    siteName: SITE_NAME,
    type: "website",
  },
  twitter: { card: "summary", title: "CadabraCraft: write and format your book", description },
};

const themeInit = `try{var t=localStorage.getItem("theme");if(t==="light"||t==="dark")document.documentElement.dataset.theme=t}catch(e){}`;

// Not SoftwareApplication yet: there is no installable release to describe (see /download/).
const siteLd = {
  "@context": "https://schema.org",
  "@type": "WebSite",
  name: SITE_NAME,
  description,
  url: SITE_URL,
  publisher: { "@type": "Organization", name: "RabinApps", url: "https://github.com/RabinApps" },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${newsreader.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInit }} />
      </head>
      <body className="antialiased">
        <SiteHeader />
        <main id="top">{children}</main>
        <SiteFooter />
        <JsonLd data={siteLd} />
      </body>
    </html>
  );
}
