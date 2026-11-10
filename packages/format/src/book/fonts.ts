import { FormatError } from "../errors";

/** Font family names the author picked; each is a family name, not a file. */
export interface BookFonts {
  body?: string;
  heading?: string;
}

const FONT_KEYS = ["body", "heading"] as const;
// eslint-disable-next-line no-control-regex -- intentional: font names may not hold control characters
const CONTROL = /[\u0000-\u001F\u007F-\u009F]/;

function fontName(v: unknown, name: string): string {
  if (
    typeof v !== "string" ||
    v.trim() === "" ||
    v !== v.trim() ||
    v.length > 100 ||
    CONTROL.test(v)
  )
    throw new FormatError(
      `manifest: "${name}" must be a trimmed font family name of 1 to 100 characters without control characters`,
    );
  return v;
}

/** Validates `manifest.fonts`: an object with only `body` and `heading`, each a plain family name. Returns only the keys that are set. */
export function validateFonts(v: unknown): BookFonts {
  if (typeof v !== "object" || v === null || Array.isArray(v))
    throw new FormatError('manifest: "fonts" must be an object');
  const o = v as Record<string, unknown>;
  for (const k of Object.keys(o))
    if (!(FONT_KEYS as readonly string[]).includes(k))
      throw new FormatError(`manifest: unknown key "fonts.${k}"`);
  const out: BookFonts = {};
  for (const k of FONT_KEYS) if (o[k] !== undefined) out[k] = fontName(o[k], `fonts.${k}`);
  return out;
}
