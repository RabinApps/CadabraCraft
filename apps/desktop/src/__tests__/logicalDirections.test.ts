import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Guard for right-to-left safety: UI code uses logical directions (`ms-`, `pe-`, `start-`, `text-start`, `border-s`, `rounded-e`, ...)
 * so the layout mirrors with `dir="rtl"`. Physical ones are allowed only in the files below, each with a maximum count and the reason
 * (also listed in docs/architecture.md, "Right-to-left layout").
 */
const ALLOWED: Record<string, { max: number; why: string }> = {
  "index.css": {
    max: 10,
    why: "Page view sheet, page card and drop cap geometry is physical (left/right pages)",
  },
  "editor/PageFrame.tsx": {
    max: 2,
    why: "Page view margins are measured from the physical left of a left/right page",
  },
  "app/export/ApproxSpread.tsx": {
    max: 6,
    why: "Print preview estimate: the left and right margins of a left or right page are physical",
  },
  "app/export/TypstSpread.tsx": {
    max: 8,
    why: "Print preview spreads: the margin outline of a left or right page is physical (the spread is laid out left to right)",
  },
  "ui/Dialog.tsx": { max: 1, why: "Centring (left-1/2 with -translate-x-1/2) is symmetric" },
  "app/references/ReferenceViewer.tsx": {
    max: 1,
    why: "Centring (left-1/2 with -translate-x-1/2) is symmetric",
  },
  "app/dialogs/ImportReportDialog.tsx": {
    max: 1,
    why: "Centring (left-1/2 with -translate-x-1/2) is symmetric",
  },
  "ui/Switch.tsx": { max: 1, why: "The knob translation has its own rtl: variant" },
  "app/shell/EntryList.tsx": {
    max: 2,
    why: 'The row menu\'s live announcement repeats the Page start label "Start on a right-hand page"; the words are prose, not a layout direction',
  },
};

const CLASS_PATTERNS = [
  /(?<![\w-])-?(?:ml|mr|pl|pr)-/,
  /(?<![\w-])-?(?:left|right)-/,
  /(?<![\w-])text-(?:left|right)\b/,
  /(?<![\w-])border-[lr]\b/,
  /(?<![\w-])rounded-(?:l|r|tl|tr|bl|br)\b/,
  /(?<![\w-])space-x-/,
  /(?<![\w-])-?translate-x-/,
  /(?<![\w-])float-(?:left|right)\b/,
];
const STYLE_PATTERNS = [
  /\b(?:margin|padding|border)(?:Left|Right)\s*:/,
  /\b(?:left|right|textAlign|float)\s*:\s*[\w"'{]/,
  /\b(?:margin|padding|border)-(?:left|right)\s*:/,
  /^\s*(?:left|right|float)\s*:/,
  /text-align\s*:\s*(?:left|right)/,
];

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    if (e.isDirectory()) return e.name === "__tests__" || e.name === "locales" ? [] : sources(p);
    return /\.(tsx|css)$/.test(e.name) && !/\.test\./.test(e.name) ? [p] : [];
  });
}

const root = join(__dirname, "..");

describe("logical directions", () => {
  const hits = new Map<string, string[]>();
  for (const file of sources(root)) {
    const rel = relative(root, file).split("\\").join("/");
    // Comments are prose, not code.
    const text = readFileSync(file, "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
    const found = text
      .split("\n")
      .filter((l) => [...CLASS_PATTERNS, ...STYLE_PATTERNS].some((re) => re.test(l)));
    if (found.length) hits.set(rel, found);
  }

  it("uses no physical direction outside the allowlist", () => {
    const stray = [...hits].filter(([f]) => !ALLOWED[f]).map(([f, l]) => `${f}: ${l[0]?.trim()}`);
    expect(stray).toEqual([]);
  });

  it("keeps each allowed file within its count (and drops entries that no longer need it)", () => {
    for (const [file, { max }] of Object.entries(ALLOWED)) {
      const n = hits.get(file)?.length ?? 0;
      expect(n, file).toBeGreaterThan(0);
      expect(n, file).toBeLessThanOrEqual(max);
    }
  });
});
