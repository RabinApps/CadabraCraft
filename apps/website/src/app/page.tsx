import { EditorMockup } from "@/components/EditorMockup";
import { ThemeToggle } from "@/components/ThemeToggle";

const REPO = "https://github.com/RabinApps/cadabracraft";
const funding = [
  { label: "GitHub Sponsors", href: "https://github.com/sponsors/RabinApps", primary: true },
  { label: "Buy me a coffee", href: "https://www.buymeacoffee.com/rabinapps", primary: false },
  {
    label: "Donate with PayPal",
    href: "https://www.paypal.com/donate/?hosted_button_id=YEJ37WF4Q3HPC",
    primary: false,
  },
];

const features = [
  {
    title: "Local-first",
    body: "Your book is a folder of plain, documented files. No account, no server, nothing leaves your machine.",
  },
  {
    title: "Sync how you like",
    body: "Point the folder at Google Drive, Dropbox or iCloud Drive. If a file changes elsewhere, you get a conflict copy, never a silent overwrite.",
  },
  {
    title: "A calm editor",
    body: "A rich-text editor where the manuscript comes first. Organize chapters, reorder them, and restore anything from the project trash.",
  },
  {
    title: "EPUB3 export",
    body: "Export a validated EPUB3 straight from your chapters.",
  },
  {
    title: "Print-ready PDF",
    body: "Templates and print PDF output are in development.",
    soon: true,
  },
  {
    title: "Light and dark",
    body: "Designed in both themes, from desktop down to a phone-width layout.",
  },
];

const btn =
  "inline-flex items-center justify-center rounded-md px-5 py-2.5 text-sm font-medium transition-colors";
const btnPrimary = `${btn} bg-accent text-accent-ink hover:opacity-90`;
const btnSecondary = `${btn} border border-border bg-surface text-ink hover:bg-sidebar`;

export default function Home() {
  return (
    <>
      <header className="sticky top-0 z-10 border-b border-border bg-bg/85 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3 sm:px-6">
          <a href="#top" className="font-book text-xl font-semibold">
            CadabraCraft
          </a>
          <nav aria-label="Main" className="flex items-center gap-4 text-sm">
            <a href="#features" className="hidden text-ink-muted hover:text-ink sm:inline">
              Features
            </a>
            <a href={REPO} className="hidden text-ink-muted hover:text-ink sm:inline">
              GitHub
            </a>
            <a href="#support" className={`${btnPrimary} !py-1.5`}>
              Support
            </a>
            <ThemeToggle />
          </nav>
        </div>
      </header>

      <main id="top">
        <section className="mx-auto max-w-6xl px-4 pb-16 pt-16 text-center sm:px-6 sm:pt-24">
          <p className="mb-4 inline-block rounded-full bg-accent-soft px-3 py-1 text-xs font-medium text-accent">
            Free and open source
          </p>
          <h1 className="mx-auto max-w-3xl font-book text-4xl font-medium leading-tight sm:text-6xl">
            Write your book. Format it beautifully.
          </h1>
          <p className="mx-auto mt-5 max-w-2xl text-lg text-ink-muted">
            CadabraCraft is a desktop app for writing and formatting books. Your work stays in plain files on your
            computer, with no account and no cloud lock-in.
          </p>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <a href={REPO} className={btnPrimary}>
              View on GitHub
            </a>
            <a href="#support" className={btnSecondary}>
              Support the project
            </a>
          </div>
          <p className="mt-3 text-xs text-ink-muted">Early development. Downloads will appear on GitHub Releases.</p>
          <div className="mx-auto mt-14 max-w-4xl text-left">
            <EditorMockup />
          </div>
        </section>

        <section id="features" className="border-y border-border bg-surface">
          <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
            <h2 className="font-book text-3xl">Made for the long haul</h2>
            <div className="mt-10 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
              {features.map((f) => (
                <div key={f.title} className="rounded-lg border border-border bg-bg p-6">
                  <h3 className="flex items-center gap-2 text-base font-semibold">
                    {f.title}
                    {f.soon && (
                      <span className="rounded-full bg-accent-soft px-2 py-0.5 text-[11px] font-medium text-accent">
                        Coming
                      </span>
                    )}
                  </h3>
                  <p className="mt-2 text-sm leading-relaxed text-ink-muted">{f.body}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="mx-auto max-w-3xl px-4 py-16 text-center sm:px-6">
          <h2 className="font-book text-3xl">Open, all the way down</h2>
          <p className="mt-4 text-ink-muted">
            The app, the file format and the exporters are developed in the open. Read the code, follow progress,
            file an issue, or send a pull request.
          </p>
          <a href={REPO} className={`${btnSecondary} mt-6`}>
            RabinApps/cadabracraft
          </a>
        </section>

        <section id="support" className="border-t border-border bg-sidebar">
          <div className="mx-auto max-w-3xl px-4 py-16 text-center sm:px-6">
            <h2 className="font-book text-3xl">Help keep it free</h2>
            <p className="mt-4 text-ink-muted">
              CadabraCraft is free for everyone. If it helps your writing, funding or sponsorship pays for
              development time and keeps the project independent.
            </p>
            <div className="mt-8 flex flex-wrap justify-center gap-3">
              {funding.map((f) => (
                <a
                  key={f.href}
                  href={f.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={f.primary ? btnPrimary : btnSecondary}
                >
                  {f.label}
                </a>
              ))}
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-border">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-2 px-4 py-6 text-sm text-ink-muted sm:px-6">
          <span>© {new Date().getFullYear()} RabinApps</span>
          <a href={REPO} className="hover:text-ink">
            Source on GitHub
          </a>
        </div>
      </footer>
    </>
  );
}
