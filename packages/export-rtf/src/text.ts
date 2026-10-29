/** Characters an RTF file cannot carry as text: C0 controls other than tab, LF and CR, and lone surrogates. */
const ILLEGAL =
  // eslint-disable-next-line no-control-regex -- intentional: matches control characters
  /[\u0000-\u0008\u000B\u000C\u000E-\u001F]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

/** The first character in `s` that RTF cannot hold, as "U+XXXX", or null. */
export function illegalChar(s: string): string | null {
  const m = ILLEGAL.exec(s);
  return m ? `U+${m[0].charCodeAt(0).toString(16).toUpperCase().padStart(4, "0")}` : null;
}

/**
 * Escapes text for an RTF group: backslash and braces get a backslash, everything outside printable ASCII becomes `\uN?`
 * (one per UTF-16 unit, so characters outside the BMP are written as their surrogate pair). The result is 7-bit ASCII.
 */
export const esc = (s: string): string =>
  s.replace(/[\\{}]/g, "\\$&").replace(/[^\x20-\x7e]/g, (c) => {
    const n = c.charCodeAt(0);
    return `\\u${n > 32767 ? n - 65536 : n}?`;
  });
