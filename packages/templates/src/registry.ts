import { BUILTIN_TEMPLATES } from "./builtin";
import type { PrintHeadingStyle, Template } from "./types";

export class TemplateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TemplateError";
  }
}

const TRIMS: string[] = ["4.25x6.87", "5x8", "5.25x8", "5.5x8.5", "6x9", "7x10", "8.5x11"];
const isNum = (v: unknown, min: number, max: number): boolean =>
  typeof v === "number" && Number.isFinite(v) && v >= min && v <= max;
const isStr = (v: unknown): v is string => typeof v === "string" && v.trim() !== "";

function heading(path: string, s: PrintHeadingStyle | undefined, errs: string[]): void {
  if (!s) return void errs.push(`${path} missing`);
  if (!isNum(s.sizeEm, 0.5, 5)) errs.push(`${path}.sizeEm out of range`);
  if (!isNum(s.spaceAboveEm, 0, 20)) errs.push(`${path}.spaceAboveEm out of range`);
  if (!isNum(s.spaceBelowEm, 0, 20)) errs.push(`${path}.spaceBelowEm out of range`);
  if (s.align !== "left" && s.align !== "center") errs.push(`${path}.align must be left or center`);
}

/** Returns a list of problems; empty means well-formed. */
export function validateTemplate(t: Template): string[] {
  const e: string[] = [];
  if (!/^[a-z][a-z0-9-]*$/.test(t.id ?? "")) e.push("id must be lowercase kebab-case");
  if (!isStr(t.name)) e.push("name required");
  if (!isStr(t.description)) e.push("description required");
  const p = t.print;
  if (!p) return [...e, "print settings missing"];
  if (!Array.isArray(p.bodyFonts) || p.bodyFonts.length === 0 || !p.bodyFonts.every(isStr))
    e.push("print.bodyFonts needs at least one family");
  if (!Array.isArray(p.headingFonts) || !p.headingFonts.every(isStr))
    e.push("print.headingFonts must be a list of families");
  if (!isNum(p.fontSizePt, 6, 24)) e.push("print.fontSizePt out of range");
  if (!isNum(p.leadingEm, 0.2, 2)) e.push("print.leadingEm out of range");
  if (p.paragraph?.style !== "indent" && p.paragraph?.style !== "spaced")
    e.push("print.paragraph.style must be indent or spaced");
  if (!isNum(p.paragraph?.indentEm, 0, 5)) e.push("print.paragraph.indentEm out of range");
  if (!isNum(p.paragraph?.spacingEm, 0, 5)) e.push("print.paragraph.spacingEm out of range");
  for (const l of [1, 2, 3] as const) heading(`print.headings.${l}`, p.headings?.[l], e);
  if (p.chapterOpening?.startOn !== "recto" && p.chapterOpening?.startOn !== "any")
    e.push("print.chapterOpening.startOn must be recto or any");
  if (!isNum(p.chapterOpening?.sinkEm, 0, 30)) e.push("print.chapterOpening.sinkEm out of range");
  const label = p.chapterOpening?.label;
  if (label !== null && (typeof label !== "string" || !label.includes("{n}")))
    e.push("print.chapterOpening.label must be null or contain {n}");
  if (typeof p.chapterOpening?.dropCap !== "boolean")
    e.push("print.chapterOpening.dropCap must be true or false");
  const orn = p.chapterOpening?.ornament;
  if (orn !== null && (typeof orn !== "string" || [...orn].length !== 1))
    e.push("print.chapterOpening.ornament must be null or a single character");
  if (!isNum(p.blockQuote?.indentEm, 0, 6)) e.push("print.blockQuote.indentEm out of range");
  if (!isNum(p.blockQuote?.sizeEm, 0.5, 2)) e.push("print.blockQuote.sizeEm out of range");
  if (!isNum(p.blockQuote?.spaceEm, 0, 5)) e.push("print.blockQuote.spaceEm out of range");
  if (!isStr(p.sceneBreak?.glyph)) e.push("print.sceneBreak.glyph required");
  if (!isNum(p.sceneBreak?.spaceEm, 0, 5)) e.push("print.sceneBreak.spaceEm out of range");
  if (!isNum(p.runningText?.sizePt, 5, 16)) e.push("print.runningText.sizePt out of range");
  if (!isNum(p.footnoteSizeEm, 0.5, 1)) e.push("print.footnoteSizeEm out of range");
  if (!TRIMS.includes(p.defaults?.trimSize))
    e.push(`print.defaults.trimSize must be one of ${TRIMS.join(", ")}`);
  const m = p.defaults?.marginsIn;
  for (const k of ["top", "bottom", "inside", "outside"] as const)
    if (!isNum(m?.[k], 0.25, 3)) e.push(`print.defaults.marginsIn.${k} out of range`);
  if (!isStr(t.epub?.css)) e.push("epub.css required");
  else if (/@import|url\(\s*["']?https?:/i.test(t.epub.css))
    e.push("epub.css must not load remote resources");
  return e;
}

function assertValid(t: Template): Template {
  const errs = validateTemplate(t);
  if (errs.length) throw new TemplateError(`Invalid template "${t.id}": ${errs.join("; ")}`);
  return t;
}

const REGISTRY = new Map<string, Template>();
for (const t of BUILTIN_TEMPLATES) {
  if (REGISTRY.has(t.id)) throw new TemplateError(`Duplicate template id "${t.id}"`);
  REGISTRY.set(t.id, assertValid(t));
}

export const DEFAULT_TEMPLATE_ID = "novel";

/** Throws `TemplateError` for an unknown id. */
export function getTemplate(id: string): Template {
  const t = REGISTRY.get(id);
  if (!t)
    throw new TemplateError(
      `Unknown template "${id}". Available: ${[...REGISTRY.keys()].join(", ")}`,
    );
  return t;
}

export const listTemplates = (): Template[] => [...REGISTRY.values()];
export const hasTemplate = (id: string): boolean => REGISTRY.has(id);
