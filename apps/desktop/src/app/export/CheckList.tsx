import { CircleAlert, CircleCheck, CircleX, Info, type LucideIcon } from "lucide-react";
import { useLingui } from "@lingui/react/macro";
import { cx } from "../../ui/cx";
import type { ExportCheck } from "../../lib/export/exportChecks";

const TONE_CLASS: Record<ExportCheck["tone"], string> = {
  ok: "bg-success-soft text-success",
  info: "bg-accent-soft text-ink",
  warn: "bg-warn-soft text-warn",
  error: "bg-danger-soft text-danger",
};

/** One shape per tone: warnings and errors must not look alike without colour (WCAG 1.4.1). */
export const checkIcons: Record<ExportCheck["tone"], LucideIcon> = {
  ok: CircleCheck,
  info: Info,
  warn: CircleAlert,
  error: CircleX,
};

/** The pre-export checks (EPUB accessibility, print layout) as a list of toned rows. */
export function CheckList({ checks, label }: { checks: ExportCheck[]; label: string }) {
  const { t } = useLingui();
  return (
    <ul aria-label={label} className="flex flex-col gap-2">
      {checks.map((c) => (
        <li
          key={c.text}
          className={cx("flex items-center gap-2 rounded-md px-3 py-2 text-sm", TONE_CLASS[c.tone])}
        >
          {(() => {
            const Icon = checkIcons[c.tone];
            return <Icon size={16} aria-hidden />;
          })()}
          {c.tone === "error" && <span className="sr-only">{t`Error:`} </span>}
          {c.tone === "warn" && <span className="sr-only">{t`Warning:`} </span>}
          {c.text}
        </li>
      ))}
    </ul>
  );
}
