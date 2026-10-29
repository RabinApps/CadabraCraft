import { useLingui } from "@lingui/react/macro";
import { cx } from "../../ui/cx";

/** Widths of the chapter rows and of the page's text lines, as drawn in the pen (`Loading / desktop`). */
const LINES = ["w-full", "w-full", "w-3/4", "w-full", "w-full", "w-3/4", "w-full"];

const Bar = ({ className }: { className: string }) => (
  <div aria-hidden className={cx("skeleton", className)} />
);

/** The editor shell drawn as grey bars while a book opens. It is one status region named "Opening <book>"; the bars are hidden from assistive technology, so nothing is announced twice. */
export function OpeningSkeleton({ name }: { name: string }) {
  const { t } = useLingui();
  return (
    <div className="flex h-dvh flex-col bg-bg text-ink" aria-busy="true">
      <header className="flex items-center gap-3 border-b border-border bg-surface px-4 py-2.5">
        <h1 aria-hidden className="min-w-0 truncate font-book text-base font-semibold">
          {name}
        </h1>
        <Bar className="ms-auto h-8 w-24 max-sm:hidden" />
        <Bar className="h-8 w-8" />
      </header>
      <div className="flex min-h-0 flex-1">
        <aside aria-hidden className="hidden w-66 shrink-0 flex-col gap-1.5 bg-sidebar p-4 lg:flex">
          <div className="mb-3 h-5" />
          {Array.from({ length: 8 }, (_, i) => (
            <Bar key={i} className="h-5 w-full" />
          ))}
        </aside>
        <main
          role="status"
          aria-label={t`Opening ${name}`}
          className="flex min-w-0 flex-1 justify-center overflow-hidden p-4 md:p-8"
        >
          <div className="h-fit w-full max-w-3xl rounded-md border border-border bg-paper p-6 md:p-11">
            <Bar className="mb-6 h-8 w-1/2 rounded-sm" />
            <div className="flex flex-col gap-5">
              {LINES.map((w, i) => (
                <Bar key={i} className={cx("h-2.5", w)} />
              ))}
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}
