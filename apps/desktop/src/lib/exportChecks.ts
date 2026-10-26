import { plural, t } from "@lingui/core/macro";
import type { Manifest } from "@cadabracraft/format";

export interface ExportCheck { tone: "ok" | "warn"; text: string }

/** Checks the Export dialog shows before an EPUB is built. Only what the app can see; EPUBCheck is not run here. */
export function epubChecks(manifest: Manifest): ExportCheck[] {
  const checks: ExportCheck[] = [];
  if (manifest.chapters.length === 0) checks.push({ tone: "warn", text: t`This book has no chapters yet.` });
  const untitled = manifest.chapters.filter((c) => c.title.trim() === "").length;
  if (untitled > 0) checks.push({ tone: "warn", text: plural(untitled, { one: "# chapter has no title", other: "# chapters have no title" }) });
  if (checks.length === 0) checks.push({ tone: "ok", text: t`No problems found` });
  return checks;
}
