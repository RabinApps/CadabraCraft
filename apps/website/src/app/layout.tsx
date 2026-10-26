import type { Metadata } from "next";
import { Inter, Newsreader } from "next/font/google";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });
const newsreader = Newsreader({ subsets: ["latin"], variable: "--font-newsreader" });

const description =
  "CadabraCraft is a free, open-source desktop app for writing and formatting books. Local-first, no account, EPUB3 and print PDF export.";

export const metadata: Metadata = {
  metadataBase: new URL("https://cadabracraft.com"),
  title: "CadabraCraft: write and format your book",
  description,
  openGraph: {
    title: "CadabraCraft: write and format your book",
    description,
    url: "https://cadabracraft.com",
    siteName: "CadabraCraft",
    type: "website",
  },
};

const themeInit = `try{var t=localStorage.getItem("theme");if(t==="light"||t==="dark")document.documentElement.dataset.theme=t}catch(e){}`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${newsreader.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInit }} />
      </head>
      <body className="antialiased">{children}</body>
    </html>
  );
}
