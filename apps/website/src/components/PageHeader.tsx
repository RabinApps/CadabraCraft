import type { ReactNode } from "react";

type Props = {
  eyebrow?: string;
  title: string;
  lead?: ReactNode;
  meta?: ReactNode;
  center?: boolean;
  children?: ReactNode;
};

/** Page title block used by every inner page: eyebrow, H1, lead and optional actions. */
export function PageHeader({ eyebrow, title, lead, meta, center = false, children }: Props) {
  const align = center ? "mx-auto text-center" : "";
  return (
    <section className={`mx-auto max-w-6xl px-4 pb-8 pt-14 sm:px-6 sm:pt-20 ${center ? "text-center" : ""}`}>
      {eyebrow &&
        (center ? (
          <p className="mb-4 inline-block rounded-full bg-accent-soft px-3 py-1 text-xs font-medium text-accent">
            {eyebrow}
          </p>
        ) : (
          <p className="mb-3 text-sm font-semibold text-accent">{eyebrow}</p>
        ))}
      <h1 className={`max-w-3xl font-book text-4xl font-medium leading-tight sm:text-5xl ${align}`}>{title}</h1>
      {lead && <p className={`mt-4 max-w-2xl text-lg text-ink-muted ${align}`}>{lead}</p>}
      {meta && <p className={`mt-3 text-xs text-ink-muted ${align}`}>{meta}</p>}
      {children && (
        <div className={`mt-8 flex flex-wrap gap-3 ${center ? "justify-center" : ""}`}>{children}</div>
      )}
    </section>
  );
}
