import { CircleAlert, CircleCheck, Info } from "lucide-react";
import { cx } from "../../ui/cx";
import type { ExportCheck } from "../../lib/exportChecks";

const TONE_CLASS: Record<ExportCheck["tone"], string> = {
  ok: "bg-success-soft text-success",
  info: "bg-accent-soft text-accent-ink",
  warn: "bg-warn-soft text-warn",
  error: "bg-danger-soft text-danger",
};

/** The pre-export checks (EPUB accessibility, print layout) as a list of toned rows. */
export function CheckList({ checks, label }: { checks: ExportCheck[]; label: string }) {
  return (
    <ul aria-label={label} className="flex flex-col gap-2">
      {checks.map((c) => (
        <li
          key={c.text}
          className={cx("flex items-center gap-2 rounded-md px-3 py-2 text-sm", TONE_CLASS[c.tone])}
        >
          {c.tone === "ok" ? (
            <CircleCheck size={16} aria-hidden />
          ) : c.tone === "info" ? (
            <Info size={16} aria-hidden />
          ) : (
            <CircleAlert size={16} aria-hidden />
          )}
          {c.text}
        </li>
      ))}
    </ul>
  );
}
