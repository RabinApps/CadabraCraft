import { t } from "@lingui/core/macro";
import type { AnalysisReport, Counted } from "@cadabracraft/shared";

/**
 * The analysis report as the screen draws it (Q06): plain rows of text and counts, built from the engine's report.
 * The rules stay in `packages/shared/src/analysis`; this file only words them. Pure, so it is tested without the page.
 */

/** Formats a whole number or a decimal for the current language (passed in, so the mapping has no locale of its own). */
export type Format = (n: number) => string;

export interface SummaryTile {
  key: "words" | "sentences" | "flesch" | "dale";
  label: string;
  /** Formatted value, or null when the figure has no value yet (drawn as a dash). */
  value: string | null;
}

export interface ReportRow {
  /** The item counted: a word, a phrase, a speech verb, or a short label for a total. */
  item: string;
  /** The number the row reports, or null when the row has no count of its own. */
  count: number | null;
  /** How the engine counted it, in plain words. */
  note: string;
}

export interface ReportSection {
  key: "words" | "phrases" | "adverbs" | "passive" | "filters" | "tags" | "cliches";
  title: string;
  /** Items found in the section (null when the section has no list yet). */
  found: number | null;
  rows: ReportRow[];
  /** Shown instead of the rows when there are none (or no list exists). */
  empty: string;
}

export interface AnalysisView {
  /** True when the scope has no words, so the screen says so instead of drawing zeros. */
  blank: boolean;
  tiles: SummaryTile[];
  sections: ReportSection[];
}

/** Flesch reading ease rounded to a whole number, or null when there is no text. */
function fleschText(report: AnalysisReport, fmt: Format): string | null {
  return report.fleschReadingEase === null ? null : fmt(Math.round(report.fleschReadingEase));
}

function summaryTiles(report: AnalysisReport, fmt: Format): SummaryTile[] {
  return [
    { key: "words", label: t`Words`, value: fmt(report.words) },
    { key: "sentences", label: t`Sentences`, value: fmt(report.sentences) },
    { key: "flesch", label: t`Flesch reading ease`, value: fleschText(report, fmt) },
    // The Dale-Chall word list is not bundled yet (no licence), so the tile shows a pending badge, not a figure.
    { key: "dale", label: t`Dale-Chall`, value: null },
  ];
}

function repeatedRows(words: readonly Counted[]): ReportRow[] {
  return words.map((w) => ({
    item: w.word,
    count: w.count,
    note: t`Content word of four or more letters, not a common function word; used four or more times`,
  }));
}

function phraseRows(phrases: readonly Counted[]): ReportRow[] {
  return phrases.map((p) => ({
    item: p.word,
    count: p.count,
    note: t`Three words in a row, not all function words; used three or more times`,
  }));
}

function adverbRows(report: AnalysisReport, fmt: Format): ReportRow[] {
  const { count, perThousand, examples } = report.adverbs;
  if (count === 0) return [];
  return [
    {
      item: examples.join(", "),
      count,
      note: t`Words ending in -ly, longer than four letters, not on the stop list. ${fmt(Math.round(perThousand * 10) / 10)} per 1,000 words`,
    },
  ];
}

function passiveRows(report: AnalysisReport, fmt: Format): ReportRow[] {
  const { count, share } = report.passive;
  if (count === 0) return [];
  return [
    {
      item: t`Was or were with a past participle`,
      count,
      note: t`${fmt(Math.round(share * 1000) / 10)}% of sentences. An estimate at sentence level: “was carried”, “were seen”`,
    },
  ];
}

function filterRows(report: AnalysisReport, fmt: Format): ReportRow[] {
  const { count, perThousand } = report.filterWords;
  if (count === 0) return [];
  return [
    {
      item: t`Perception and feeling verbs`,
      count,
      note: t`felt, saw, heard, noticed and similar. ${fmt(Math.round(perThousand * 10) / 10)} per 1,000 words`,
    },
  ];
}

function tagRows(report: AnalysisReport): ReportRow[] {
  const { tags, said, distinct } = report.dialogue;
  if (tags === 0) return [];
  return [
    {
      item: t`Dialogue tags`,
      count: tags,
      note: t`A speech verb within three words after a closing quote mark`,
    },
    { item: t`said`, count: said, note: t`Tags that use “said”` },
    { item: t`Different speech verbs`, count: distinct, note: t`Speech verbs used as tags` },
  ];
}

function sections(report: AnalysisReport, fmt: Format): ReportSection[] {
  const words = report.repeatedWords;
  const phrases = report.repeatedPhrases;
  const adverbs = adverbRows(report, fmt);
  const passive = passiveRows(report, fmt);
  const filters = filterRows(report, fmt);
  const tags = tagRows(report);
  return [
    {
      key: "words",
      title: t`Repeated words`,
      found: words.length,
      rows: repeatedRows(words),
      empty: t`No content word is repeated often in this text.`,
    },
    {
      key: "phrases",
      title: t`Repeated phrases`,
      found: phrases.length,
      rows: phraseRows(phrases),
      empty: t`No three-word phrase is repeated in this text.`,
    },
    {
      key: "adverbs",
      title: t`Adverbs`,
      found: report.adverbs.count,
      rows: adverbs,
      empty: t`No adverbs ending in -ly.`,
    },
    {
      key: "passive",
      title: t`Passive sentences`,
      found: report.passive.count,
      rows: passive,
      empty: t`No passive sentences found.`,
    },
    {
      key: "filters",
      title: t`Filter words`,
      found: report.filterWords.count,
      rows: filters,
      empty: t`No filter words found.`,
    },
    {
      key: "tags",
      title: t`Dialogue tags`,
      found: report.dialogue.tags,
      rows: tags,
      empty: t`No dialogue tags found.`,
    },
    {
      key: "cliches",
      title: t`Clichés`,
      found: null,
      rows: [],
      empty: t`No list bundled yet, so clichés are not counted.`,
    },
  ];
}

/** The whole screen for one report: the summary tiles and the seven sections in order. */
export function analysisView(report: AnalysisReport, fmt: Format): AnalysisView {
  return {
    blank: report.words === 0,
    tiles: summaryTiles(report, fmt),
    sections: sections(report, fmt),
  };
}
