import { SponsorBand } from "@/components/SponsorBand";
import { pageMetadata } from "@/lib/seo";
import { btnPrimary, btnSecondary, RELEASES, REPO } from "@/lib/site";

export const metadata = pageMetadata(
  "Download CadabraCraft",
  "CadabraCraft is a free desktop app for writing and formatting books. Downloads will appear on GitHub Releases.",
  "/download/",
);

export default function Download() {
  return (
    <>
      <section className="mx-auto max-w-3xl px-4 py-16 text-center sm:px-6 sm:py-24">
        <h1 className="font-book text-4xl font-medium sm:text-5xl">Download CadabraCraft</h1>
        <p className="mt-5 text-lg text-ink-muted">
          CadabraCraft is still in early development and has no packaged release yet. Installers will be published on
          GitHub Releases, and you can build it from source today.
        </p>
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <a href={RELEASES} className={btnPrimary}>
            GitHub Releases
          </a>
          <a href={REPO} className={btnSecondary}>
            Build from source
          </a>
        </div>
        <p className="mt-6 text-sm text-ink-muted">
          Print PDF export uses Typst, which you install once on your computer.
        </p>
      </section>
      <SponsorBand />
    </>
  );
}
