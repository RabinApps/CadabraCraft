import {
  MAX_GLOSSARY_ALIASES,
  MAX_GLOSSARY_DEFINITION,
  MAX_INDEX_TERM,
  termKey,
  type GlossaryEntry,
} from "@cadabracraft/shared";

/** Why an index term, subentry or target cannot be used, or null when it can. Messages come from the caller's `t`. */
export type TermProblem = "empty" | "long" | "lines";

export function termProblem(value: string): TermProblem | null {
  if (value.trim() === "") return "empty";
  if (/[\r\n]/.test(value)) return "lines";
  return value.length > MAX_INDEX_TERM ? "long" : null;
}

/** Splits "a, b" into the aliases of a glossary entry: trimmed, no blanks, no repeats. */
export const parseAliases = (text: string): string[] => {
  const seen = new Set<string>();
  return text
    .split(/[,;\n]/)
    .map((a) => a.trim())
    .filter((a) => a !== "" && !seen.has(termKey(a)) && seen.add(termKey(a)));
};

export type EntryProblem =
  | "term-empty"
  | "term-long"
  | "term-lines"
  | "term-used"
  | "alias"
  | "aliases-many"
  | "definition-long";

/** What is wrong with a glossary entry about to be saved (other entries are checked for a term used twice), or null. */
export function entryProblem(
  entry: Pick<GlossaryEntry, "id" | "term" | "aliases" | "definition">,
  others: readonly GlossaryEntry[],
): EntryProblem | null {
  const term = termProblem(entry.term);
  if (term) return `term-${term}`;
  if (others.some((o) => o.id !== entry.id && termKey(o.term) === termKey(entry.term)))
    return "term-used";
  const aliases = entry.aliases ?? [];
  if (aliases.length > MAX_GLOSSARY_ALIASES) return "aliases-many";
  if (aliases.some((a) => termProblem(a))) return "alias";
  return entry.definition.length > MAX_GLOSSARY_DEFINITION ? "definition-long" : null;
}
