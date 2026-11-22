import { getContent } from "@/content";
import { localePath } from "@/i18n/config";
import { getLocale, type LocaleParams } from "@/lib/params";
import { ContactForm } from "@/components/ContactForm";
import { SponsorButtons } from "@/components/SponsorButtons";
import { pageMetadata } from "@/lib/seo";

export async function generateMetadata({ params }: LocaleParams) {
  const locale = await getLocale(params);
  return pageMetadata(
    locale,
    "Support the project",
    "CadabraCraft is free and source-available. Sponsor it through GitHub Sponsors, Buy Me a Coffee or PayPal.",
    "/support/",
  );
}

const funds = [
  "Development time on the editor, exporters and templates",
  "Code-signing and release builds for macOS, Windows and Linux",
  "Keeping the file format documented and stable",
];

export default async function Support({ params }: LocaleParams) {
  const locale = await getLocale(params);
  return (
    <section className="mx-auto max-w-3xl px-4 py-16 text-center sm:px-6 sm:py-24">
      <h1 className="font-book text-4xl font-medium sm:text-5xl">Help keep CadabraCraft free</h1>
      <p className="mt-5 text-lg text-ink-muted">
        No ads, no accounts, no tracking. Sponsorship pays for development time and keeps the
        project independent.
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
      <div id="contact" className="mx-auto mt-14 max-w-[40rem] scroll-mt-24 text-center">
        <h2 className="font-book text-2xl">Contact us</h2>
        <p className="mt-3 text-ink-muted">
          Questions, bug reports or ideas? Send a message and I will reply. The form comes from
          support.cadabracraft.com and loads on this page only.
        </p>
        <ContactForm />
      </div>
    </section>
  );
}
