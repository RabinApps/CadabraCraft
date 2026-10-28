import { DEFAULT_TEMPLATE_ID, getTemplate, type Template } from "@cadabracraft/templates";
import { FontNotAvailableError, PdfExportError } from "../errors";
import type { FontChoice, PdfMargins, PdfOptions } from "../types";

export function resolveTemplate(options: PdfOptions): Template {
  const t = options.template ?? DEFAULT_TEMPLATE_ID;
  return typeof t === "string" ? getTemplate(t) : t;
}

/** Families a render needs, for the availability check. */
export function requestedFonts(options: PdfOptions): { body: string[]; heading: string[] } {
  const p = resolveTemplate(options).print;
  const body = options.fonts?.body ? [options.fonts.body] : p.bodyFonts;
  const heading = options.fonts?.heading
    ? [options.fonts.heading]
    : p.headingFonts.length
      ? p.headingFonts
      : body;
  return { body, heading };
}

/**
 * Pick the font families. With `available` (installed family names) the first available candidate wins and
 * a request with no available family throws `FontNotAvailableError`. Without it, the first candidate is used.
 */
export function resolveFonts(options: PdfOptions, available?: Iterable<string>): FontChoice {
  const req = requestedFonts(options);
  if (!available) return { body: req.body[0]!, heading: req.heading[0]! };
  const have = new Set([...available].map((f) => f.toLowerCase()));
  const pick = (families: string[], role: "body" | "heading"): string => {
    const hit = families.find((f) => have.has(f.toLowerCase()));
    if (!hit) throw new FontNotAvailableError(families, role);
    return hit;
  };
  return { body: pick(req.body, "body"), heading: pick(req.heading, "heading") };
}

export function resolveMargins(options: PdfOptions, t: Template): PdfMargins {
  const m = { ...t.print.defaults.marginsIn, ...options.margins };
  for (const [k, v] of Object.entries(m)) {
    if (typeof v !== "number" || !Number.isFinite(v) || v < 0.2 || v > 3)
      throw new PdfExportError(`Invalid ${k} margin: ${v}`);
  }
  return m;
}
