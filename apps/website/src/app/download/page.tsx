import { PageHeader } from "@/components/PageHeader";
import { SponsorBand } from "@/components/SponsorBand";
import { pageMetadata } from "@/lib/seo";
import { RELEASES, REPO, btnPrimary, btnSecondary } from "@/lib/site";

export const metadata = pageMetadata(
  "Download CadabraCraft",
  "CadabraCraft is a free desktop app for writing and formatting books. Installers for macOS and Linux come first, with Windows coming soon.",
  "/download/",
);

// Matches .github/workflows/release.yml (macOS and Linux; Windows is not built for release yet). Replace the status with a link when a release is published.
const platforms = [
  { name: "macOS", detail: "Universal build for Apple silicon and Intel (.dmg)" },
  { name: "Windows", detail: "Installer (.exe), WebView2 included", soon: true },
  { name: "Linux", detail: "AppImage (x86-64)" },
] as const;

const good = [
  { title: "No account", body: "Write, edit and export with no sign-in and no network." },
  {
    title: "Update check",
    body: "The app checks GitHub Releases for updates and tells you, only if you allow it.",
  },
  { title: "Voices are optional", body: "Audiobook voices download only when you ask for them." },
] as const;

export default function Download() {
  return (
    <>
      <PageHeader
        center
        eyebrow="Early development"
        title="Download CadabraCraft"
        lead="There is no packaged release yet. Installers for macOS and Linux will be published on GitHub Releases first, with Windows coming soon. You can build the app from source today."
      >
        <a href={RELEASES} className={btnPrimary}>
          GitHub Releases
        </a>
        <a href="#build" className={btnSecondary}>
          Build from source
        </a>
      </PageHeader>

      <section aria-labelledby="platforms" className="mx-auto max-w-6xl px-4 pb-14 pt-4 sm:px-6">
        <h2 id="platforms" className="sr-only">
          Platforms
        </h2>
        <ul className="grid gap-4 md:grid-cols-3">
          {platforms.map((p) => (
            <li key={p.name} className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-6">
              <h3 className="text-lg font-semibold">{p.name}</h3>
              <p className="text-ink-muted">{p.detail}</p>
              <p className="mt-auto w-fit rounded-full bg-sidebar px-2.5 py-1 text-xs font-semibold text-warn">
                {"soon" in p ? "Coming soon" : "Not available yet"}
              </p>
            </li>
          ))}
        </ul>
      </section>

      <section className="border-y border-border bg-surface">
        <div className="mx-auto max-w-6xl px-4 py-14 sm:px-6">
          <h2 className="font-book text-3xl">Good to know</h2>
          <div className="mt-8 grid gap-8 md:grid-cols-3 md:gap-10">
            {good.map((g) => (
              <div key={g.title}>
                <h3 className="font-semibold">{g.title}</h3>
                <p className="mt-1.5 leading-relaxed text-ink-muted">{g.body}</p>
              </div>
            ))}
          </div>
          <p className="mt-8 text-sm text-ink-muted">Print PDF export uses Typst, which comes with the app.</p>
        </div>
      </section>

      <section id="build" className="mx-auto max-w-3xl scroll-mt-20 px-4 py-14 sm:px-6">
        <h2 className="font-book text-3xl">Build from source</h2>
        <p className="mt-3 text-ink-muted">
          Install the prerequisites listed in the{" "}
          <a href={`${REPO}#quick-start`} className="text-accent hover:underline">
            README
          </a>
          , then from the repository folder:
        </p>
        <pre className="mt-5 overflow-x-auto rounded-md bg-ink p-5 text-sm text-bg">
          <code>{"pnpm install\npnpm tauri dev"}</code>
        </pre>
      </section>
      <SponsorBand />
    </>
  );
}
