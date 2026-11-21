import { getContent } from "@/content";
import { localePath } from "@/i18n/config";
import { getLocale, type LocaleParams } from "@/lib/params";
import { PageHeader } from "@/components/PageHeader";
import { SponsorBand } from "@/components/SponsorBand";
import { pageMetadata } from "@/lib/seo";
import { appVersion, installers } from "@/lib/release";
import { RELEASES, REPO, btnPrimary, btnSecondary } from "@/lib/site";

export async function generateMetadata({ params }: LocaleParams) {
  const locale = await getLocale(params);
  return pageMetadata(
    locale,
    "Download CadabraCraft",
    "CadabraCraft is a free desktop app for writing and formatting books. Download installers for macOS and Linux, with Windows coming soon.",
    "/download/",
  );
}

const good = [
  { title: "No account", body: "Write, edit and export with no sign-in and no network." },
  {
    title: "Update check",
    body: "The app checks GitHub Releases for updates and tells you, only if you allow it.",
  },
  { title: "Voices are optional", body: "Audiobook voices download only when you ask for them." },
] as const;

export default async function Download({ params }: LocaleParams) {
  const locale = await getLocale(params);
  const version = appVersion();
  const platforms = installers(version);
  return (
    <>
      <PageHeader
        center
        eyebrow={`Version ${version}`}
        title="Download CadabraCraft"
        lead="Installers for macOS and Linux are on GitHub Releases, with Windows coming soon. You can also build the app from source."
      >
        <a href={RELEASES} className={btnPrimary}>
          All releases
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
              {p.href ? (
                <div className="mt-auto flex flex-col gap-2">
                  <a href={p.href} className={btnPrimary}>
                    {p.action}
                  </a>
                  {p.alternates?.map((a) => (
                    <a key={a.href} href={a.href} className={btnSecondary}>
                      {a.action}
                    </a>
                  ))}
                </div>
              ) : (
                <p className="mt-auto w-fit rounded-full bg-sidebar px-2.5 py-1 text-xs font-semibold text-warn">
                  Coming soon
                </p>
              )}
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
