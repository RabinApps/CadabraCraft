import { t } from "@lingui/core/macro";

/** Longest selection that Find takes over as its query. */
export const PREFILL_MAX = 100;

/**
 * The query to pre-fill when Find opens: the selected text when it is one non-blank line shorter than 100 characters,
 * otherwise null (the previous query stays). `text` is the selection with blocks joined by "\n".
 */
export function prefillQuery(text: string): string | null {
  if (!text.trim() || text.length >= PREFILL_MAX || /[\r\n\u2028\u2029]/.test(text)) return null;
  return text;
}

/** "3 of 12" while there are matches, "No results" for a query without any, nothing for an empty query. */
export function countLabel(query: string, total: number, index: number): string {
  if (!query) return "";
  return total === 0 ? t`No results` : t`${index} of ${total}`;
}
