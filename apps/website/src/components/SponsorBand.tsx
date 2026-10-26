import { SponsorButtons } from "./SponsorButtons";

export function SponsorBand({ title = "Help keep it free" }: { title?: string }) {
  return (
    <section id="support" className="border-t border-border bg-sidebar">
      <div className="mx-auto max-w-3xl px-4 py-16 text-center sm:px-6">
        <h2 className="font-book text-3xl">{title}</h2>
        <p className="mt-4 text-ink-muted">
          CadabraCraft is free for everyone. If it helps your writing, funding or sponsorship pays for development
          time and keeps the project independent.
        </p>
        <div className="mt-8">
          <SponsorButtons />
        </div>
      </div>
    </section>
  );
}
