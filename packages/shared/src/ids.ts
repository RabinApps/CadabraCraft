/**
 * Chapter and matter page ids are used as XML ids and file names in exports (`<id>.xhtml`), so they are limited to
 * a letter followed by letters, digits, `_` or `-` (at most 64 characters).
 */
const ENTRY_ID = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;

export const isValidEntryId = (id: string): boolean => ENTRY_ID.test(id);

/**
 * A comment thread's id travels in the chapter JSON (`comment` mark) and names the thread in the page's sidecar, so it
 * follows the same rule as page ids: a letter, then letters, digits, `_` or `-`, at most 64 characters.
 */
export const isValidCommentId = (id: unknown): boolean =>
  typeof id === "string" && ENTRY_ID.test(id);
