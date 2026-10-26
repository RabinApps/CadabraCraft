const chapters = ["The Lantern", "A Door in the Hedge", "What the River Kept", "Salt and Ink", "Midwinter"];

/** Stylised recreation of the desktop editor layout (chapters / manuscript / details). Decorative. */
export function EditorMockup() {
  return (
    <div
      aria-hidden="true"
      className="overflow-hidden rounded-lg border border-border bg-surface shadow-2xl shadow-black/10"
    >
      <div className="flex items-center gap-2 border-b border-border px-4 py-2.5">
        <span className="size-2.5 rounded-full bg-border" />
        <span className="size-2.5 rounded-full bg-border" />
        <span className="size-2.5 rounded-full bg-border" />
        <span className="ml-3 text-xs text-ink-muted">The Salt Orchard · Saved</span>
      </div>
      <div className="flex gap-1 border-b border-border px-4 py-2 text-xs text-ink-muted">
        {["B", "I", "U", "H1", "H2", "“ ”", "•", "1.", "Link"].map((t) => (
          <span key={t} className="rounded-md px-2 py-1 first:bg-accent-soft first:text-accent">
            {t}
          </span>
        ))}
      </div>
      <div className="grid grid-cols-[1fr] md:grid-cols-[170px_1fr_150px]">
        <div className="hidden bg-sidebar p-3 md:block">
          <p className="mb-2 text-[11px] font-medium uppercase tracking-wide text-ink-muted">Chapters</p>
          {chapters.map((c, i) => (
            <p
              key={c}
              className={`rounded-md px-2 py-1.5 text-xs ${i === 1 ? "bg-accent-soft font-medium text-accent" : "text-ink-muted"}`}
            >
              {i + 1}. {c}
            </p>
          ))}
        </div>
        <div className="bg-paper px-6 py-8 sm:px-12">
          <p className="font-book text-xs uppercase tracking-widest text-ink-muted">Chapter 2</p>
          <h3 className="mt-1 font-book text-2xl">A Door in the Hedge</h3>
          <p className="mt-4 font-book text-[15px] leading-[1.65] text-ink">
            The hedge had been trimmed flat for forty years, which was why nobody believed Mara when she said the
            door had always been there. It was small and green, and it smelled faintly of ink.
          </p>
          <p className="mt-3 font-book text-[15px] leading-[1.65] text-ink">
            She pressed her palm against the wood. Somewhere behind it, a page turned.
          </p>
        </div>
        <div className="hidden bg-sidebar p-3 text-xs text-ink-muted md:block">
          <p className="mb-2 text-[11px] font-medium uppercase tracking-wide">Details</p>
          <p>Words: 2,418</p>
          <p className="mt-1">Chapters: 5</p>
          <p className="mt-3 rounded-md bg-surface px-2 py-1.5 text-success">Saved to your folder</p>
        </div>
      </div>
    </div>
  );
}
