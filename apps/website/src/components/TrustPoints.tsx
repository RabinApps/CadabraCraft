import type { Locale } from "@/i18n/config";
import { getMessages } from "@/i18n/messages";

const stroke = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.8,
  strokeLinecap: "round",
  strokeLinejoin: "round",
} as const;

const paths = {
  check: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="m8.5 12.5 2.5 2.5 4.5-5" />
    </>
  ),
  shield: (
    <>
      <path d="M12 3 5 6v5c0 4.5 3 8 7 10 4-2 7-5.5 7-10V6l-7-3Z" />
      <path d="m9 12 2 2 4-4" />
    </>
  ),
  folder: <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z" />,
} as const;

/** Three short reassurances under the hero buttons. */
export function TrustPoints({ locale }: { locale: Locale }) {
  const t = getMessages(locale).trust;
  const items = [
    { icon: "check", label: t.free },
    { icon: "shield", label: t.noAccount },
    { icon: "folder", label: t.yours },
  ] as const;
  return (
    <ul className="mt-6 flex flex-col items-center gap-2 text-sm font-medium sm:flex-row sm:justify-center sm:gap-8">
      {items.map((i) => (
        <li key={i.icon} className="flex items-center gap-2">
          <svg aria-hidden viewBox="0 0 24 24" className="size-[18px] text-accent" {...stroke}>
            {paths[i.icon]}
          </svg>
          {i.label}
        </li>
      ))}
    </ul>
  );
}
