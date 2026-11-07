/** A raw manifest as the current version writes it: every reference of an older book is a file. For expectations in migration tests. */
export const kinded = <T extends { references?: object[] }>(raw: T): T =>
  raw.references
    ? { ...raw, references: raw.references.map((r) => ({ kind: "file", ...r })) }
    : raw;
