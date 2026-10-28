/**
 * Chapter and matter page ids are used as XML ids and file names in exports (`<id>.xhtml`), so they are limited to
 * a letter followed by letters, digits, `_` or `-` (at most 64 characters).
 */
const ENTRY_ID = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;

export const isValidEntryId = (id: string): boolean => ENTRY_ID.test(id);
