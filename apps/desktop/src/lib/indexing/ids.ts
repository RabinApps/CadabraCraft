let counter = 0;

/** A new index place id (`indexEntry` mark): the format's id rule (a letter, then letters, digits, `_` or `-`, at most 64 characters). */
export const newIndexEntryId = (now = Date.now(), salt = Math.random()): string =>
  `ix-${now.toString(36)}${(counter++ % 1296).toString(36)}${Math.floor(salt * 36 ** 4).toString(36)}`;

/** A new glossary entry id (`glossaryTerm` mark and `manifest.glossary.entries`), by the same rule. */
export const newGlossaryId = (now = Date.now(), salt = Math.random()): string =>
  `gl-${now.toString(36)}${(counter++ % 1296).toString(36)}${Math.floor(salt * 36 ** 4).toString(36)}`;
