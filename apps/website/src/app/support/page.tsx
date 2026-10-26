import { SponsorButtons } from "@/components/SponsorButtons";
import { pageMetadata } from "@/lib/seo";

export const metadata = pageMetadata(
  "Support CadabraCraft",
  "CadabraCraft is free and open source. Sponsor it through GitHub Sponsors, Buy Me a Coffee or PayPal.",
  "/support/",
);

const funds = [
  "Development time on the editor, exporters and templates",
  "Code-signing and release builds for macOS, Windows and Linux",
  "Keeping the file format documented and stable",
];

export default function Support() {
  return (
    <section className="mx-auto max-w-3xl px-4 py-16 text-center sm:px-6 sm:py-24">
      <h1 className="font-book text-4xl font-medium sm:text-5xl">Help keep CadabraCraft free</h1>
      <p className="mt-5 text-lg text-ink-muted">
        No ads, no accounts, no tracking. Sponsorship pays for development time and keeps the project independent.
      </p>
      <div className="mt-8">
        <SponsorButtons />
      </div>
      <div className="mx-auto mt-14 max-w-xl text-left">
        <h2 className="font-book text-2xl">What your support pays for</h2>
        <ul className="mt-4 list-disc space-y-2 pl-5 text-ink-muted">
          {funds.map((f) => (
            <li key={f}>{f}</li>
          ))}
        </ul>
      </div>
    </section>
  );
}
