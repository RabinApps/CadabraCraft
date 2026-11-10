import "../globals.css";

// Root layout for the redirect stubs that keep pre-locale URLs (/features/, /guides/...) working.
export default function LegacyLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
