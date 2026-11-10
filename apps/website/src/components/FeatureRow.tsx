import { Screenshot } from "./Screenshot";
import type { FeatureGroup } from "@/content/en/content";

function Points({ points }: { points: readonly string[] }) {
  return (
    <ul className="space-y-2.5 text-ink-muted">
      {points.map((p) => (
        <li key={p} className="flex gap-2.5 leading-relaxed">
          <svg aria-hidden viewBox="0 0 16 16" className="mt-1 size-4 shrink-0 text-accent" fill="none">
            <path d="m3 8.5 3.2 3L13 4.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
          <span>{p}</span>
        </li>
      ))}
    </ul>
  );
}

/**
 * One feature group. With a screenshot the rows alternate text and image; without one the bullets sit beside the
 * text so no empty placeholder ships.
 */
export function FeatureRow({ group, flip }: { group: FeatureGroup; flip: boolean }) {
  const { shot } = group;
  const text = (
    <div className="flex flex-col gap-3.5">
      <p className="text-sm font-semibold text-accent">{group.eyebrow}</p>
      <h2 id={`${group.id}-title`} className="font-book text-3xl font-semibold">
        {group.title}
      </h2>
      <p className="text-lg leading-relaxed text-ink-muted">{group.lead}</p>
      {shot && <Points points={group.points} />}
    </div>
  );
  return (
    <section id={group.id} aria-labelledby={`${group.id}-title`} className="scroll-mt-20">
      <div className="grid items-center gap-8 lg:grid-cols-2 lg:gap-16">
        {shot ? (
          <>
            <div className={flip ? "lg:order-2" : ""}>{text}</div>
            <div className={flip ? "lg:order-1" : ""}>
              <Screenshot name={shot.name} alt={shot.alt} className="rounded-lg border border-border shadow-lg" />
            </div>
          </>
        ) : (
          <>
            {text}
            <Points points={group.points} />
          </>
        )}
      </div>
    </section>
  );
}
