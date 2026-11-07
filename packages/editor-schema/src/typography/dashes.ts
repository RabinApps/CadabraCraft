export const EN_DASH = "–";
export const EM_DASH = "—";
export const ELLIPSIS = "…";

/** `---` becomes an em dash, `--` an en dash and `...` an ellipsis. */
export const convertDashes = (text: string): string =>
  text
    .replace(/---/g, EM_DASH)
    .replace(/--/g, EN_DASH)
    .replace(/\.\.\./g, ELLIPSIS);
