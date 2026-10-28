export const XML_HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';

/** Escapes text for an XML text node or a double-quoted attribute. */
export const esc = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Characters XML 1.0 cannot carry (control characters, lone surrogates, U+FFFE and U+FFFF). */
const ILLEGAL =
  // eslint-disable-next-line no-control-regex -- intentional: matches XML-illegal control characters
  /[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

/** The first character in `s` that XML cannot hold, as "U+XXXX", or null. */
export function illegalXmlChar(s: string): string | null {
  const m = ILLEGAL.exec(s);
  return m ? `U+${m[0].charCodeAt(0).toString(16).toUpperCase().padStart(4, "0")}` : null;
}
