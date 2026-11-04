/** Shared by the forced-colors and increased-contrast specs. */

/** What a person without color perception can still see of an element. */
export const LOOK = (el: Element) => {
  const cs = getComputedStyle(el);
  const rgba = (c: string) => (c.match(/[\d.]+/g) ?? []).map(Number);
  const visible = (style: string, width: string, color: string) =>
    style !== "none" && style !== "hidden" && parseFloat(width) > 0 && (rgba(color)[3] ?? 1) > 0;
  return {
    outline: visible(cs.outlineStyle, cs.outlineWidth, cs.outlineColor),
    border: visible(cs.borderTopStyle, cs.borderTopWidth, cs.borderTopColor),
    // A width only counts when something is drawn with it (the computed width of "none" is not 0 in forced colors).
    outlineWidth: visible(cs.outlineStyle, cs.outlineWidth, cs.outlineColor)
      ? parseFloat(cs.outlineWidth)
      : 0,
    borderWidth: visible(cs.borderTopStyle, cs.borderTopWidth, cs.borderTopColor)
      ? parseFloat(cs.borderTopWidth)
      : 0,
    background: cs.backgroundColor,
    color: cs.color,
    weight: cs.fontWeight,
    opacity: cs.opacity,
    outlineColor: cs.outlineColor,
    borderColor: cs.borderTopColor,
    forcedColorAdjust: cs.forcedColorAdjust,
  };
};
export type Look = ReturnType<typeof LOOK>;
export const hasEdge = (l: Look) => l.outline || l.border;

const luminance = (c: string) => {
  const [r, g, b] = (c.match(/[\d.]+/g) ?? []).slice(0, 3).map((v) => {
    const x = Number(v) / 255;
    return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
};
export const ratio = (a: string, b: string) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
};
