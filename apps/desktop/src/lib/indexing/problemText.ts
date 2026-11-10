import { t } from "@lingui/core/macro";
import type { EntryProblem, TermProblem } from "./validation";

/** The sentence for a problem with a glossary entry. */
export function entryProblemText(p: EntryProblem): string {
  switch (p) {
    case "term-empty":
      return t`A glossary term needs a name.`;
    case "term-long":
      return t`The term is too long.`;
    case "term-lines":
      return t`A term is one line.`;
    case "term-used":
      return t`The glossary already has this term.`;
    case "alias":
      return t`An alternative spelling is empty, too long or has line breaks.`;
    case "aliases-many":
      return t`There are too many alternative spellings.`;
    case "definition-long":
      return t`The definition is too long.`;
  }
}

/** The sentence for a problem with an index term, subentry or target. */
export function termProblemText(p: TermProblem): string {
  switch (p) {
    case "empty":
      return t`Write a term first.`;
    case "long":
      return t`This is too long.`;
    case "lines":
      return t`Use one line.`;
  }
}

/** The problem of an entry, split by the field it belongs to (nothing until `shown`, so a form does not scold before a first try). */
export function entryErrors(
  problem: EntryProblem | null,
  shown: boolean,
): { term?: string; aliases?: string; definition?: string } {
  if (!shown || !problem) return {};
  const text = entryProblemText(problem);
  if (problem === "alias" || problem === "aliases-many") return { aliases: text };
  return problem === "definition-long" ? { definition: text } : { term: text };
}
