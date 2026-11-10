import { plural, t } from "@lingui/core/macro";
import type { LoudnessReport } from "@cadabracraft/export-audio";

/** How far the integrated loudness may sit from the target and still pass (LU). Mirrors `TOLERANCE_LU`. */
export const LOUDNESS_TOLERANCE_LU = 1;
/** The highest true peak that passes (dBTP). Mirrors `TRUE_PEAK_LIMIT_DBTP`. */
export const LOUDNESS_PEAK_LIMIT_DBTP = -3;

/** The loudness of a whole audiobook: the chapter furthest from the target and the highest peak of all the chapters read. */
export interface LoudnessSummary {
  integratedLufs: number;
  truePeakDbtp: number;
  targetLufs: number;
  /** Chapters measured (chapters with nothing to read are left out). */
  chapters: number;
}

export interface LoudnessRow {
  label: string;
  value: string;
}

export interface LoudnessView {
  rows: LoudnessRow[];
  passed: boolean;
  /** The plain-words result of the pass or fail rule. */
  verdict: string;
  /** How many chapters the numbers cover, for the scope line. */
  chapters: number;
}

/** Rounds a dB value to one decimal, the precision the card shows. */
const oneDecimal = (db: number): number => Math.round(db * 10) / 10;

/**
 * The pass rule: the integrated loudness within the tolerance of the target and the true peak at or below the limit.
 * Both are checked on the one-decimal values the card shows, so the verdict never contradicts the numbers beside it.
 */
export const loudnessPasses = (
  r: Pick<LoudnessReport, "integratedLufs" | "truePeakDbtp" | "targetLufs">,
): boolean =>
  Math.abs(oneDecimal(r.integratedLufs) - r.targetLufs) <= LOUDNESS_TOLERANCE_LU &&
  oneDecimal(r.truePeakDbtp) <= LOUDNESS_PEAK_LIMIT_DBTP;

/** Maps a measured loudness to the card's rows and its pass or fail verdict. A peak problem is named before a loudness one. */
export function loudnessView(r: LoudnessSummary): LoudnessView {
  const passed = loudnessPasses(r);
  const peakHigh = oneDecimal(r.truePeakDbtp) > LOUDNESS_PEAK_LIMIT_DBTP;
  const verdict = passed
    ? t`Within the retail target`
    : peakHigh
      ? t`Above -3 dBTP: lower the peak`
      : t`Outside the retail target: adjust the source`;
  return {
    rows: [
      { label: t`Integrated loudness`, value: `${oneDecimal(r.integratedLufs).toFixed(1)} LUFS` },
      { label: t`True peak`, value: `${oneDecimal(r.truePeakDbtp).toFixed(1)} dBTP` },
      { label: t`Target`, value: `${r.targetLufs} LUFS` },
    ],
    passed,
    verdict,
    chapters: r.chapters,
  };
}

/** The scope line under the card: how many chapters the numbers cover. */
export const loudnessScope = (chapters: number): string =>
  plural(chapters, {
    one: "Measured on # chapter.",
    other:
      "Measured on # chapters. Shows the chapter furthest from the target and the highest peak.",
  });

/**
 * The whole book's loudness from its chapters' reports. Null when there is no audio to measure, or when any chapter
 * has no report (a render from before loudness was measured): the card is then left out, not guessed.
 */
export function summarizeLoudness(
  results: readonly { status: string; loudness?: LoudnessReport }[],
): LoudnessSummary | null {
  const measured = results.filter((r) => r.status !== "empty");
  if (measured.length === 0) return null;
  const reports: LoudnessReport[] = [];
  for (const r of measured) {
    if (!r.loudness) return null;
    reports.push(r.loudness);
  }
  const deviation = (r: LoudnessReport) => Math.abs(r.integratedLufs - r.targetLufs);
  const furthest = reports.reduce((a, b) => (deviation(b) > deviation(a) ? b : a));
  return {
    integratedLufs: furthest.integratedLufs,
    truePeakDbtp: Math.max(...reports.map((r) => r.truePeakDbtp)),
    targetLufs: furthest.targetLufs,
    chapters: reports.length,
  };
}
