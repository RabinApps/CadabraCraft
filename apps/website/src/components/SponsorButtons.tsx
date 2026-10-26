import { btnPrimary, btnSecondary, funding } from "@/lib/site";

export function SponsorButtons() {
  return (
    <div className="flex flex-wrap justify-center gap-3">
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
  );
}
