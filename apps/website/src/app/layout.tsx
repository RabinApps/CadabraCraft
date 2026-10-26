import type { Metadata } from "next";
import { Inter, Newsreader } from "next/font/google";
import { JsonLd } from "@/components/JsonLd";
import { SiteFooter } from "@/components/SiteFooter";
import { SiteHeader } from "@/components/SiteHeader";
import { OG_IMAGE } from "@/lib/seo";
import { REPO, SITE_NAME, SITE_URL } from "@/lib/site";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });
const newsreader = Newsreader({ subsets: ["latin"], variable: "--font-newsreader" });

const description =
  "CadabraCraft is a free, open-source desktop app for writing and formatting books. Local-first, no account, EPUB3 and print PDF export.";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: { default: "CadabraCraft: free book writing and formatting software", template: "%s | CadabraCraft" },
  description,
  alternates: { canonical: "/" },
  openGraph: {
    title: "CadabraCraft: write and format your book",
    description,
    url: SITE_URL,
    siteName: SITE_NAME,
    type: "website",
    images: [{ url: OG_IMAGE, width: 1200, height: 630, alt: "CadabraCraft: write and format your book" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "CadabraCraft: write and format your book",
    description,
    images: [OG_IMAGE],
  },
};

const themeInit = `try{var t=localStorage.getItem("theme");if(t==="light"||t==="dark")document.documentElement.dataset.theme=t}catch(e){}`;

const appLd = {
  "@context": "https://schema.org",
  "@type": "SoftwareApplication",
  name: SITE_NAME,
  description,
  applicationCategory: "BusinessApplication",
  operatingSystem: "macOS, Windows, Linux",
  url: SITE_URL,
  codeRepository: REPO,
  offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
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
        <JsonLd data={appLd} />
      </body>
    </html>
  );
}
