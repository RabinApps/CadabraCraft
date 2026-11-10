import { plural, t } from "@lingui/core/macro";
import type { EpubcheckFailure, EpubcheckMessage, EpubcheckReport } from "../bridge";
import type { ExportCheck } from "./exportChecks";

const TONE: Record<EpubcheckMessage["severity"], ExportCheck["tone"] | null> = {
  fatal: "error",
  error: "error",
  warning: "warn",
  info: "info",
  usage: "info",
  suppressed: null,
};

/** Worst first, so errors are not buried under notes. */
const ORDER: Record<ExportCheck["tone"], number> = { error: 0, warn: 1, info: 2, ok: 3 };

/** "RSC-005: Duplicate ID (OEBPS/ch1.xhtml:3)": EPUBCheck's id and text, then where it is. The text is EPUBCheck's own (English). */
export function messageText(m: EpubcheckMessage): string {
  const where = m.file ? ` (${m.file}${m.line ? `:${m.line}` : ""})` : "";
  return `${m.id ? `${m.id}: ` : ""}${m.message}${where}`;
}

/** The report as rows for the check list; a clean book is a single "ok" row. */
export function checksFromReport(report: EpubcheckReport): ExportCheck[] {
  const rows = report.messages.flatMap((m): ExportCheck[] => {
    const tone = TONE[m.severity];
    return tone ? [{ tone, text: messageText(m) }] : [];
  });
  rows.sort((a, b) => ORDER[a.tone] - ORDER[b.tone]);
  if (report.omitted > 0) {
    const n = report.omitted;
    rows.push({
      tone: "info",
      text: plural(n, {
        one: "# more message is not shown",
        other: "# more messages are not shown",
      }),
    });
  }
  if (rows.length === 0) rows.push({ tone: "ok", text: t`EPUBCheck found no problems.` });
  return rows;
}

/** A short summary line: "1 error, 2 warnings". */
export function summaryText(report: EpubcheckReport): string {
  const errors = report.counts.fatal + report.counts.error;
  const { warning } = report.counts;
  if (errors === 0 && warning === 0) return t`No errors or warnings.`;
  const e = plural(errors, { one: "# error", other: "# errors" });
  const w = plural(warning, { one: "# warning", other: "# warnings" });
  return t`${e}, ${w}`;
}

/** What the rejection of a bridge call is, whatever was thrown. */
export function asFailure(e: unknown): EpubcheckFailure {
  if (
    typeof e === "object" &&
    e !== null &&
    "kind" in e &&
    typeof (e as { kind: unknown }).kind === "string"
  ) {
    return e as EpubcheckFailure;
  }
  return { kind: "other", message: e instanceof Error ? e.message : String(e) };
}

/** The sentence for a check that did not finish. */
export function failureText(f: EpubcheckFailure): string {
  switch (f.kind) {
    case "not_found":
      return t`The EPUB checker that comes with CadabraCraft was not found. Reinstall the app to get it back.`;
    case "timeout":
      return t`The check took longer than ${f.seconds} seconds and was stopped.`;
    case "cancelled":
      return t`The check was stopped.`;
    case "no_epub":
      return t`There is no exported EPUB for this edition yet. Export it first, then check it.`;
    case "failed":
    case "other":
      return t`The EPUB check could not finish: ${f.message}`;
  }
}
