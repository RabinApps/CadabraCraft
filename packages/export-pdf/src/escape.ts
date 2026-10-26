/**
 * Escaping for Typst source. Everything user-written goes through one of these two functions,
 * never string concatenation.
 */

/** Characters that always start markup or code in Typst markup mode. */
const ALWAYS = new Set(["\\", "#", "$", "*", "_", "`", "<", ">", "@", "~", "[", "]", '"', "'"]);

const isDigit = (c: string): boolean => c >= "0" && c <= "9";

export interface EscapeOptions {
  /** The text begins a line (start of a paragraph, list item, heading...), so list/heading markers are active. */
  lineStart?: boolean;
  /**
   * The text directly follows a `#func[...]` call. `.name` or `(args)` would be parsed as a field access
   * or another call on the result, so a leading `.` or `(` is escaped.
   */
  afterCall?: boolean;
}

/** Normalises newlines and drops control characters that Typst source cannot carry. */
function normalise(s: string): string {
  return s
    .replace(/\r\n?|[\u000b\u000c\u0085\u2028\u2029]/g, "\n")
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000e-\u001f\u007f]/g, "");
}

/** Escape plain text for Typst markup mode so it renders verbatim. */
export function escapeMarkup(input: string, opts: EscapeOptions = {}): string {
  const s = normalise(input);
  let out = "";
  let lineStart = opts.lineStart ?? false;
  let digitCount = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i]!;
    const next = s[i + 1];
    const prev = s[i - 1];
    if (c === "\n") {
      out += "\\\n"; // Typst line break
      lineStart = true;
      digitCount = 0;
      continue;
    }
    if (lineStart && (c === " " || c === "\t")) {
      out += c;
      continue;
    }
    let esc = ALWAYS.has(c);
    if (!esc && c === "/") esc = next === "/" || next === "*" || lineStart;
    if (!esc && lineStart && (c === "=" || c === "-" || c === "+")) esc = true;
    if (!esc && c === "-") esc = next === "-" || next === "?" || prev === "-";
    if (!esc && c === "." && s.startsWith("...", i)) esc = true; // would become an ellipsis
    if (!esc && c === "." && lineStart && digitCount > 0) esc = true; // "1." enum marker
    if (!esc && i === 0 && opts.afterCall && (c === "." || c === "(")) esc = true;
    out += esc ? "\\" + c : c;
    if (lineStart) {
      if (isDigit(c)) digitCount++;
      else lineStart = false;
    }
  }
  return out;
}

/** A Typst string literal ("...") for use in code. */
export function typstString(input: string): string {
  let out = '"';
  for (const ch of normalise(input)) {
    if (ch === "\n") out += "\\n";
    else if (ch === "\\") out += "\\\\";
    else if (ch === '"') out += '\\"';
    else out += ch;
  }
  return out + '"';
}
