import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// WCAG 1.4.3 (text, 4.5:1) and 1.4.11 (control boundaries, 3:1) for the design tokens (docs/accessibility.md).
const css = readFileSync(new URL("../styles/tokens.css", import.meta.url), "utf8");

function block(selector: string): Record<string, string> {
  const start = css.indexOf(`${selector} {`);
  const body = css.slice(start, css.indexOf("}", start));
  return Object.fromEntries(
    [...body.matchAll(/--([\w-]+):\s*(#[0-9a-f]{6})\b/gi)].map((m) => [m[1]!, m[2]!]),
  );
}

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function ratio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

const text: [string, string][] = [
  ["ink", "bg"],
  ["ink", "surface"],
  ["ink", "raised"],
  ["ink-muted", "bg"],
  ["ink-muted", "sidebar"],
  ["ink-muted", "surface"],
  ["ink-muted", "accent-soft"],
  ["accent", "bg"],
  ["accent", "surface"],
  ["accent", "accent-soft"],
  ["accent-ink", "accent"],
  ["success", "success-soft"],
  ["warn", "warn-soft"],
  ["danger", "danger-soft"],
  ["danger", "surface"],
];
const boundaries: [string, string][] = [
  ["border-strong", "bg"],
  ["border-strong", "surface"],
  ["border-strong", "raised"],
];

// WCAG 1.4.11 for what is not text: the grip and row icons (ink-muted), the focus ring and the pressed border (accent),
// on every surface they sit on, including the highlighted row (accent-soft).
const nonText: [string, string][] = [
  ["ink-muted", "bg"],
  ["ink-muted", "sidebar"],
  ["ink-muted", "surface"],
  ["ink-muted", "accent-soft"],
  ["accent", "bg"],
  ["accent", "sidebar"],
  ["accent", "surface"],
  ["accent", "accent-soft"],
];

describe.each([
  ["light", ":root"],
  ["dark", ':root[data-theme="dark"]'],
])("%s tokens", (_name, selector) => {
  const base = block(":root");
  const t = { ...base, ...block(selector) };
  it.each(text)("%s on %s is at least 4.5:1", (fg, bg) => {
    expect(ratio(t[fg]!, t[bg]!)).toBeGreaterThanOrEqual(4.5);
  });
  it.each(boundaries)("%s against %s is at least 3:1", (fg, bg) => {
    expect(ratio(t[fg]!, t[bg]!)).toBeGreaterThanOrEqual(3);
  });
  it.each(nonText)(
    "%s against %s (icons, focus ring, pressed border) is at least 3:1",
    (fg, bg) => {
      expect(ratio(t[fg]!, t[bg]!)).toBeGreaterThanOrEqual(3);
    },
  );
});

// "Increase contrast" (prefers-contrast: more) restates two tokens in index.css: the hairline --border becomes --border-strong
// and --ink-muted becomes --ink. The pairs are checked after that override, read from the style sheet so a change there
// is caught (a11y-forced-colors.spec.ts measures the same in a browser).
const indexCss = readFileSync(new URL("../styles/contrast.css", import.meta.url), "utf8");
const moreBlock = indexCss.slice(indexCss.indexOf("@media (prefers-contrast: more)"));
const overrides = Object.fromEntries(
  [...moreBlock.slice(0, moreBlock.indexOf("}")).matchAll(/--([\w-]+):\s*var\(--([\w-]+)\)/g)].map(
    (m) => [m[1]!, m[2]!],
  ),
);

describe("the overrides under prefers-contrast: more", () => {
  it("restate the two tokens the docs name", () => {
    expect(overrides).toEqual({ border: "border-strong", "ink-muted": "ink" });
  });
});

describe.each([
  ["light", ":root"],
  ["dark", ':root[data-theme="dark"]'],
])("%s tokens with increased contrast", (_name, selector) => {
  const base: Record<string, string> = { ...block(":root"), ...block(selector) };
  const t = { ...base };
  for (const [name, source] of Object.entries(overrides)) t[name] = base[source]!;
  const surfaces = ["bg", "sidebar", "surface", "raised", "accent-soft"];
  it.each(surfaces)("muted text (ink-muted) on %s is at least 4.5:1", (bg) => {
    expect(ratio(t["ink-muted"]!, t[bg]!)).toBeGreaterThanOrEqual(4.5);
  });
  it.each(surfaces)("muted icons (ink-muted) against %s are at least 3:1", (bg) => {
    expect(ratio(t["ink-muted"]!, t[bg]!)).toBeGreaterThanOrEqual(3);
  });
  it.each(["bg", "surface", "raised"])("the border against %s is at least 3:1", (bg) => {
    expect(ratio(t["border"]!, t[bg]!)).toBeGreaterThanOrEqual(3);
  });
  it.each(["bg", "sidebar", "surface", "accent-soft"])(
    "the focus ring and pressed border (accent) against %s stay at least 3:1",
    (bg) => {
      expect(ratio(t["accent"]!, t[bg]!)).toBeGreaterThanOrEqual(3);
    },
  );
});
